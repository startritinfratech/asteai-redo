'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssessmentStep } from '@asteai/types';
import { ApiError, errorMessage } from '@/lib/api';
import { assessmentApi } from './api';
import { eventsToSend, remainingEvents } from './integrityEvents';
import type { Item } from './items.types';

export interface AssessmentState {
  /** The screen to show, while the assessment is running. */
  item: Item | null;
  done: boolean;
  resultId: string | null;
  /** True while an answer is being sent; screens disable their controls. */
  busy: boolean;
  /** A problem to show above the current screen (or instead of it, when `fatal`). */
  error: string | null;
  fatal: boolean;
  submit: (response: Record<string, unknown>) => void;
  /** Tries to open the assessment again after a failed start. */
  retry: () => void;
}

/**
 * Runs one role-fit assessment. Starting is idempotent on the server, so a reload
 * resumes where the candidate left off.
 *
 * Leaving the page (tab hidden) and pasting are counted here and sent with the next
 * answer; the server times every answer itself.
 */
export function useAssessment(requisitionId: string): AssessmentState {
  const [step, setStep] = useState<AssessmentStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState(false);
  const events = useRef({ blur: 0, paste: 0 });
  // Only the newest load may update state: an older one that finishes late (React
  // mounts twice in development, or a slow retry) must not overwrite a live session.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const next = await assessmentApi.start(requisitionId);
      if (seq !== loadSeq.current) return;
      setStep(next);
      setError(null);
      setFatal(false);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError(errorMessage(err, 'Could not open the assessment'));
      // Keep showing the current screen if there is one; the next answer resyncs.
      setFatal((wasFatal) => wasFatal || !stepRef.current);
    }
  }, [requisitionId]);

  const stepRef = useRef<AssessmentStep | null>(null);
  stepRef.current = step;

  useEffect(() => {
    void load();
    return () => {
      loadSeq.current += 1; // ignore anything still in flight after unmount
    };
  }, [load]);

  const running = step !== null && !step.done;
  useEffect(() => {
    if (!running) return;
    const onVisibility = () => {
      if (document.hidden) events.current.blur += 1;
    };
    const onPaste = () => {
      events.current.paste += 1;
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('paste', onPaste);
    };
  }, [running]);

  const submit = useCallback(
    (response: Record<string, unknown>) => {
      if (!step?.item || busy) return;
      // The API accepts at most 50 of each per answer; the rest goes with later answers.
      const sent = eventsToSend(events.current);
      setBusy(true);
      setError(null);
      assessmentApi
        .answer(step.sessionId, step.item.id, response, sent)
        .then((next) => {
          events.current = remainingEvents(events.current, sent);
          setStep(next);
        })
        .catch(async (err) => {
          setError(errorMessage(err, 'Your answer was not saved. Try again.'));
          if (err instanceof ApiError && err.status === 422) {
            // Either the answer didn't fit, or an earlier send did arrive and the
            // server has moved on. Reloading shows whichever screen is current.
            await load();
          } else if (err instanceof ApiError && err.status === 409 && /expired/i.test(err.message)) {
            setFatal(true);
          } else if (err instanceof ApiError && err.status === 409 && /reset/i.test(err.message)) {
            // Support reset this session while it was open: start the new one.
            await load();
          }
        })
        .finally(() => setBusy(false));
    },
    [step, busy, load],
  );

  return {
    item: (step?.item as Item | undefined) ?? null,
    done: step?.done ?? false,
    resultId: step?.resultId ?? null,
    busy,
    error,
    fatal,
    submit,
    retry: () => {
      setError(null);
      setFatal(false);
      void load();
    },
  };
}
