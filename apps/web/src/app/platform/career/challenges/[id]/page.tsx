'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import type { ChallengeDetail, ChallengeLanguage, SubmissionResult } from '@asteai/types';
import { ApiError, errorMessage, fetcher } from '@/lib/api';
import { Button, Empty, Panel, Tag } from '@/components/ui';
import { CAREER_KEYS, careerApi } from '@/features/career/api';
import { CodeEditor } from '@/features/career/CodeEditor';
import { TelemetryRecorder } from '@/features/career/editor';
import { percentileLabel, TEST_STATUS_LABEL } from '@/features/career/format';
import styles from '@/features/career/Career.module.css';

const LANGUAGE_LABEL: Record<ChallengeLanguage, string> = {
  python: 'Python 3', javascript: 'JavaScript (Node)', java: 'Java', cpp: 'C++', go: 'Go',
};

const draftKey = (id: string, lang: string) => `career.challenge.${id}.${lang}`;
function loadDraft(id: string, lang: string): string | null {
  try { return localStorage.getItem(draftKey(id, lang)); } catch { return null; }
}
function saveDraft(id: string, lang: string, code: string) {
  try { localStorage.setItem(draftKey(id, lang), code); } catch { /* storage blocked: drafts are a convenience */ }
}

/** Split pane: the problem on the left, the editor and results on the right. */
export default function ChallengeRunnerPage() {
  const { id } = useParams<{ id: string }>();
  const { data: challenge, error } = useSWR<ChallengeDetail>(id ? CAREER_KEYS.challenge(id) : null, fetcher);

  const [language, setLanguage] = useState<ChallengeLanguage | null>(null);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(42);
  const telemetry = useRef<TelemetryRecorder | null>(null);
  const split = useRef<HTMLDivElement>(null);

  useEffect(() => {
    telemetry.current = new TelemetryRecorder();
    const onVisibility = () => { if (document.visibilityState === 'hidden') telemetry.current?.hidden(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (challenge && !language) setLanguage(challenge.languages[0] ?? null);
  }, [challenge, language]);

  useEffect(() => {
    if (!challenge || !language) return;
    setCode(loadDraft(challenge.id, language) ?? challenge.starter[language] ?? '');
  }, [challenge, language]);

  useEffect(() => {
    if (!challenge || !language) return;
    const t = setTimeout(() => saveDraft(challenge.id, language, code), 400);
    return () => clearTimeout(t);
  }, [challenge, language, code]);

  async function submit() {
    if (!challenge || !language || !code.trim()) return;
    setBusy(true);
    setSubmitError('');
    telemetry.current?.submitted();
    try {
      setResult(await careerApi.submit(challenge.id, { language, source: code, telemetry: telemetry.current?.snapshot() ?? {} }));
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setSubmitError(
        status === 429 ? 'You have reached the submission limit. Wait a little before trying again.'
          : status === 409 ? 'Your previous submission is still running.'
            : status === 502 ? 'The code runner is unavailable. This attempt was not counted.'
              : errorMessage(err, 'Submission failed'),
      );
    } finally {
      setBusy(false);
    }
  }

  function drag(e: React.PointerEvent<HTMLButtonElement>) {
    const box = split.current?.getBoundingClientRect();
    if (!box) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setLeft(Math.min(70, Math.max(25, ((ev.clientX - box.left) / box.width) * 100)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  if (error) return <Empty message="Challenge not found." />;
  if (!challenge || !language) return <Empty message="Loading…" />;

  return (
    <>
      <div className={styles.between}>
        <div className={styles.row}>
          <Link href="/platform/career/challenges" className={styles.link}>← Challenges</Link>
          <h1 className={styles.h2}>{challenge.title}</h1>
          <Tag color={challenge.difficulty === 'easy' ? 'mint' : challenge.difficulty === 'medium' ? 'gold' : 'rose'}>{challenge.difficulty}</Tag>
        </div>
        <span className={styles.muted}>
          {challenge.testCount} tests · {challenge.timeLimitMs / 1000}s · {Math.round(challenge.memoryLimitKb / 1024)} MB
        </span>
      </div>

      <div ref={split} className={styles.split} style={{ ['--left' as string]: `${left}%` }}>
        <section className={styles.pane} aria-label="Problem">
          <p className={styles.problem}>{challenge.prompt}</p>
          {challenge.examples.map((ex, i) => (
            <div key={i} className={styles.stack}>
              <h2 className={styles.h3}>Example {i + 1}</h2>
              <span className={styles.muted}>Input</span>
              <pre className={styles.example}>{ex.stdin}</pre>
              <span className={styles.muted}>Output</span>
              <pre className={styles.example}>{ex.expectedOutput}</pre>
            </div>
          ))}
          <p className={styles.muted}>
            Read from standard input and print to standard output. Hidden tests check edge cases; only pass/fail is shown for them.
          </p>
        </section>

        <button
          type="button"
          className={styles.divider}
          aria-label="Resize panes"
          aria-orientation="vertical"
          role="separator"
          aria-valuenow={Math.round(left)}
          aria-valuemin={25}
          aria-valuemax={70}
          onPointerDown={drag}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setLeft((l) => Math.max(25, l - 3));
            if (e.key === 'ArrowRight') setLeft((l) => Math.min(70, l + 3));
          }}
        />

        <section className={styles.pane} aria-label="Solution">
          <div className={styles.between}>
            <select
              aria-label="Language"
              className={styles.select}
              style={{ width: 'auto' }}
              value={language}
              onChange={(e) => setLanguage(e.target.value as ChallengeLanguage)}
            >
              {challenge.languages.map((l) => <option key={l} value={l}>{LANGUAGE_LABEL[l]}</option>)}
            </select>
            <Button variant="primary" disabled={busy || !code.trim()} onClick={() => { void submit(); }}>
              {busy ? 'Running tests…' : 'Submit'}
            </Button>
          </div>

          <CodeEditor
            value={code}
            language={language}
            label={`${LANGUAGE_LABEL[language]} solution`}
            onChange={setCode}
            onKey={() => telemetry.current?.key()}
            onPaste={(n) => telemetry.current?.paste(n)}
          />

          {submitError && <p className={styles.error} role="alert">{submitError}</p>}
          {result && <SubmissionPanel result={result} />}
        </section>
      </div>
    </>
  );
}

function SubmissionPanel({ result }: { result: SubmissionResult }) {
  return (
    <div aria-live="polite">
    <Panel className={styles.stack}>
      <div className={styles.between}>
        <span className={styles.row}>
          <Tag color={result.status === 'passed' ? 'mint' : 'rose'}>{result.status === 'passed' ? 'All tests passed' : 'Not yet'}</Tag>
          <strong>{result.passedTests}/{result.totalTests} tests · score {Math.round(result.score)}</strong>
        </span>
        <span className={styles.muted}>
          {result.maxRuntimeMs !== null && `${result.maxRuntimeMs} ms`}{result.maxMemoryKb !== null && ` · ${Math.round(result.maxMemoryKb / 1024)} MB`}
        </span>
      </div>
      {result.compileOutput && <pre className={styles.compile}>{result.compileOutput}</pre>}
      <ul className={styles.tests}>
        {result.tests.map((t) => (
          <li key={t.index} className={`${styles.test} ${t.passed ? styles.testPass : styles.testFail}`}>
            <strong>{t.example ? `Example ${t.index + 1}` : `Hidden test ${t.index + 1}`}</strong>
            <span>{t.passed ? 'Passed' : TEST_STATUS_LABEL[t.status]}</span>
            {t.timeMs !== null && <span className={styles.muted}>{t.timeMs} ms</span>}
          </li>
        ))}
      </ul>
      {result.passport && (
        <p className={styles.muted}>
          Passport · {result.passport.competency.replace(/_/g, ' ')}: {Math.round(result.passport.score)} ({percentileLabel(result.passport.percentile)})
        </p>
      )}
      {result.credential && (
        <p className={styles.ok}>First full pass: credential <span className={styles.mono}>{result.credential.code}</span> signed and added to your passport.</p>
      )}
    </Panel>
    </div>
  );
}
