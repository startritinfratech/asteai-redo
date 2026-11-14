'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { UserRole, VoiceCommandRequest, VoiceCommandResult } from '@asteai/types';
import { api, errorMessage } from '@/lib/api';
import { execute, needsConfirmation } from './execute';
import { matchLocally } from './localIntent';
import { pageTargets, type RegisteredTarget } from './registry';
import { routeTargets } from './routeTargets';
import { isSpeechSupported, listenOnce, speak, stopSpeaking, type Listening } from './speech';
import styles from './VoiceAssistant.module.css';

type Phase = 'idle' | 'listening' | 'thinking' | 'confirm';

/**
 * Pages where the assistant is switched off. During an assessment it could otherwise be
 * asked to solve a question or pick an answer; in the interview Studio it would compete
 * with the live AI interview for the microphone.
 */
const VOICE_OFF_PATHS = ['/platform/assess', '/platform/studio'];

export function VoiceAssistant({ role }: { role: UserRole }) {
  const pathname = usePathname();
  if (VOICE_OFF_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  return <VoiceDock key={`${role}:${pathname}`} role={role} pathname={pathname} />;
}

/**
 * Push-to-talk navigator for the signed-in app (button or Alt+V).
 *
 * Speech → local match for simple commands, otherwise POST /assistant/command with the
 * targets on screen → run the chosen target. Anything marked `confirm` waits for the
 * user to press Confirm. Browsers without speech recognition get a text box instead.
 */
function VoiceDock({ role, pathname }: { role: UserRole; pathname: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState<{ cmd: VoiceCommandResult; targets: RegisteredTarget[] } | null>(null);
  const [speechOk, setSpeechOk] = useState(false);
  const [useText, setUseText] = useState(false);
  const listening = useRef<Listening | null>(null);
  const mounted = useRef(true);
  const clarification = useRef<VoiceCommandRequest['clarification']>();
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'en';

  useEffect(() => setSpeechOk(isSpeechSupported()), []);

  // Leaving the page (or entering a voice-off page) must release the microphone.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listening.current?.cancel();
      listening.current = null;
      stopSpeaking();
    };
  }, []);

  const say = useCallback((text: string) => {
    setReply(text);
    speak(text, lang);
  }, [lang]);

  const run = useCallback(async (cmd: VoiceCommandResult, targets: RegisteredTarget[]) => {
    try {
      const currentTargets = [...routeTargets(role), ...pageTargets()];
      // Only use the same registration that was offered when the command was resolved.
      const active = currentTargets.filter((target) => targets.some((offered) =>
        target.kind === 'route' ? offered.id === target.id : offered === target,
      ));
      const ok = await execute(cmd, active, router);
      if (mounted.current) say(ok ? cmd.speech : "That isn't available on this page any more.");
    } catch (err) {
      if (mounted.current) say(errorMessage(err, 'Could not complete that action.'));
    } finally {
      if (mounted.current) setPhase('idle');
    }
  }, [role, router, say]);

  const handle = useCallback(async (utterance: string) => {
    setHeard(utterance);
    if (!utterance) { setPhase('idle'); return; }

    const targets: RegisteredTarget[] = [...routeTargets(role), ...pageTargets()];
    setPhase('thinking');
    let cmd = matchLocally(utterance, targets);
    if (!cmd) {
      try {
        const body: VoiceCommandRequest = {
          utterance,
          pathname,
          language: lang,
          clarification: clarification.current,
          targets: targets.map(({ id, kind, label, description, confirm }) => ({ id, kind, label, description, confirm })),
        };
        cmd = await api.post<VoiceCommandResult>('/assistant/command', body);
      } catch (err) {
        if (!mounted.current) return;
        say(errorMessage(err, 'The assistant is unavailable.'));
        setPhase('idle');
        return;
      }
    }

    if (!mounted.current) return;
    clarification.current = cmd.kind === 'clarify' && cmd.speech
      ? { utterance: clarification.current?.utterance ?? utterance.slice(0, 500), question: cmd.speech.slice(0, 500) }
      : undefined;
    if (needsConfirmation(cmd, targets)) {
      setPending({ cmd, targets });
      setPhase('confirm');
      say(`${cmd.speech} Confirm?`);
      return;
    }
    await run(cmd, targets);
  }, [role, pathname, lang, run, say]);

  const start = useCallback(async () => {
    stopSpeaking();
    setReply('');
    setPending(null);
    setPhase('listening');
    try {
      const current = listenOnce(lang);
      listening.current = current;
      const utterance = await current.result;
      if (!mounted.current) return;
      if (window.location.pathname !== pathname) return;
      await handle(utterance);
    } catch (err) {
      if (!mounted.current) return;
      setUseText(true);
      say(errorMessage(err));
      setPhase('idle');
    } finally {
      listening.current = null;
    }
  }, [lang, handle, pathname, say]);

  const toggle = useCallback(() => {
    if (phase === 'listening') listening.current?.cancel();
    else if (phase === 'idle') void start();
  }, [phase, start]);

  useEffect(() => {
    if (!speechOk) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'v') { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [speechOk, toggle]);

  const confirm = async () => {
    if (!pending) return;
    setPending(null);
    setPhase('thinking');
    await run(pending.cmd, pending.targets);
  };
  const cancel = () => {
    setPending(null);
    setPhase('idle');
    say('Cancelled.');
  };

  return (
    <div className={styles.dock}>
      <div className={styles.status} aria-live="polite">
        {heard && <p className={styles.heard}>“{heard}”</p>}
        {phase === 'thinking' && <p className={styles.reply}>Working…</p>}
        {reply && phase !== 'thinking' && <p className={styles.reply}>{reply}</p>}
        {phase === 'confirm' && (
          <div className={styles.actions}>
            <button type="button" className={styles.confirm} onClick={confirm}>Confirm</button>
            <button type="button" className={styles.cancel} onClick={cancel}>Cancel</button>
          </div>
        )}
      </div>

      {speechOk && !useText ? (
        <button
          type="button"
          className={styles.mic}
          data-phase={phase}
          onClick={toggle}
          disabled={phase === 'thinking' || phase === 'confirm'}
          aria-pressed={phase === 'listening'}
          aria-label={phase === 'listening' ? 'Stop listening' : 'Voice command (Alt+V)'}
          title="Voice command (Alt+V)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1a7 7 0 0 0 6-6.9h-2Z" />
          </svg>
        </button>
      ) : (
        <form
          className={styles.typed}
          onSubmit={(e) => { e.preventDefault(); const t = typed.trim(); setTyped(''); void handle(t); }}
        >
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type a command…"
            aria-label="Assistant command"
            disabled={phase !== 'idle'}
          />
        </form>
      )}
      {speechOk && (
        <button type="button" className={styles.cancel} disabled={phase !== 'idle'} onClick={() => setUseText(!useText)}>
          {useText ? 'Use microphone' : 'Type instead'}
        </button>
      )}
    </div>
  );
}
