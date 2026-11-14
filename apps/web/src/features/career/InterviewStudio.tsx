'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import type {
  PassportProfile, PublicCreditSettings, StudioCompletion, StudioMode, StudioTurnResponse,
} from '@asteai/types';
import { ApiError, errorMessage, fetcher } from '@/lib/api';
import { Button, Empty, PageHeader, Panel, Tag } from '@/components/ui';
import { CAREER_KEYS, careerApi, type InterviewCatalogue } from './api';
import { speechLocale } from './format';
import { RubricBreakdown } from './RubricBreakdown';
import { isDictationSupported, isSpeechOutputSupported, speakText, stopSpeaking } from './speech';
import { VoiceAnswer } from './VoiceAnswer';
import styles from './Career.module.css';

const SESSION_KEY = 'career.interview.session';

type Phase =
  | { kind: 'setup' }
  | { kind: 'running'; turn: StudioTurnResponse }
  | { kind: 'scoring'; turn: StudioTurnResponse }
  | { kind: 'done'; result: StudioCompletion };

function remember(id: string | null) {
  try {
    if (id) sessionStorage.setItem(SESSION_KEY, id);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* storage blocked: resume just won't work */ }
}

/** AI Interview Studio: setup → question/answer turns (typed or spoken) → rubric scores. */
export function InterviewStudio() {
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const [error, setError] = useState<{ text: string; needsCredits?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: passport } = useSWR<PassportProfile>(CAREER_KEYS.passport, fetcher);

  // Pick up an interview interrupted by a reload.
  useEffect(() => {
    let id: string | null = null;
    try { id = sessionStorage.getItem(SESSION_KEY); } catch { /* ignore */ }
    if (!id) return;
    careerApi.session(id).then((s) => {
      if (s.status !== 'active') return remember(null);
      const last = s.transcript[s.transcript.length - 1];
      const answers = s.transcript.filter((t) => t.role === 'candidate').length;
      const questions = s.transcript.filter((t) => t.role === 'interviewer').length;
      setPhase({
        kind: 'running',
        turn: {
          sessionId: s.sessionId, mode: s.mode, language: s.language, status: 'active', questionNumber: questions,
          maxQuestions: s.mode === 'trades_voice' ? 6 : 8, answersGiven: answers, canComplete: answers >= 3,
          prompt: last?.role === 'interviewer' ? { text: last.text, language: s.language, speak: s.mode === 'trades_voice' } : null,
        },
      });
    }).catch(() => remember(null));
  }, []);

  useEffect(() => () => stopSpeaking(), []);

  function fail(err: unknown, fallback: string) {
    setError({
      text: errorMessage(err, fallback),
      needsCredits: err instanceof ApiError && err.status === 402,
    });
  }

  async function start(input: { mode: StudioMode; domain: string; skill: string; language: string }) {
    setBusy(true);
    setError(null);
    try {
      const turn = await careerApi.startInterview(input);
      remember(turn.sessionId);
      setPhase({ kind: 'running', turn });
    } catch (err) {
      fail(err, 'Could not start the interview');
    } finally {
      setBusy(false);
    }
  }

  async function answer(turn: StudioTurnResponse, body: Parameters<typeof careerApi.answer>[1]) {
    setBusy(true);
    setError(null);
    try {
      setPhase({ kind: 'running', turn: await careerApi.answer(turn.sessionId, body) });
    } catch (err) {
      fail(err, 'Your answer was not sent. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function finish(turn: StudioTurnResponse) {
    stopSpeaking();
    setPhase({ kind: 'scoring', turn });
    setError(null);
    try {
      const result = await careerApi.complete(turn.sessionId);
      remember(null);
      setPhase({ kind: 'done', result });
    } catch (err) {
      setPhase({ kind: 'running', turn });
      fail(err, 'Scoring did not finish. Try again.');
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Career Studio"
        title="AI Interview Studio"
        sub="Technical rubric interviews, and voice interviews for railway and trades roles in your language."
      />
      {error && (
        <p className={styles.error} role="alert">
          {error.text}
          {error.needsCredits && <> <Link href="/platform/wallet" className={styles.link}>Top up credits</Link></>}
        </p>
      )}
      {phase.kind === 'setup' && <InterviewSetup busy={busy} onStart={(i) => { void start(i); }} />}
      {phase.kind === 'running' && (
        <InterviewRunner
          turn={phase.turn}
          busy={busy}
          onAnswer={(body) => { void answer(phase.turn, body); }}
          onFinish={() => { void finish(phase.turn); }}
        />
      )}
      {phase.kind === 'scoring' && <Panel><Empty message="Scoring your interview against the rubric…" /></Panel>}
      {phase.kind === 'done' && (
        <>
          <RubricBreakdown rubric={phase.result.rubric} mode={phase.result.mode} credential={phase.result.credential} passportSlug={passport?.slug} />
          <div className={styles.row}>
            <Button onClick={() => setPhase({ kind: 'setup' })}>Start another interview</Button>
            <Link href="/platform/career" className={styles.link}>See your passport</Link>
          </div>
        </>
      )}
    </>
  );
}

// ── Setup ────────────────────────────────────────────────────────────────────

function InterviewSetup({ busy, onStart }: {
  busy: boolean;
  onStart: (i: { mode: StudioMode; domain: string; skill: string; language: string }) => void;
}) {
  const { data: catalogue, error } = useSWR<InterviewCatalogue>(CAREER_KEYS.catalogue, fetcher);
  const { data: credits } = useSWR<PublicCreditSettings>('/public-settings/credits', fetcher);
  const cost = credits?.costs.find((c) => c.feature === 'ai_interview')?.cost;

  const [mode, setMode] = useState<StudioMode>('technical');
  const [domain, setDomain] = useState('');
  const [skill, setSkill] = useState('');
  const [language, setLanguage] = useState('en');

  const tradeFields = useMemo(
    () => (catalogue?.frontline ?? []).filter((f) => /railway|trades/i.test(f.field)),
    [catalogue],
  );
  const domains = mode === 'technical' ? (catalogue?.domains.tech ?? []) : tradeFields.map((f) => f.field);
  const roles = tradeFields.find((f) => f.field === domain)?.roles ?? [];

  useEffect(() => {
    setDomain('');
    setSkill('');
    setLanguage(mode === 'trades_voice' ? 'hi' : 'en');
  }, [mode]);

  const voiceBlocked = mode === 'trades_voice' && typeof window !== 'undefined' && !isDictationSupported();
  const ready = domain && skill.trim().length >= 2 && !voiceBlocked;

  if (error) return <Empty message="Could not load the interview options." />;
  if (!catalogue) return <Empty message="Loading…" />;

  return (
    <Panel className={styles.stack}>
      <fieldset className={styles.modes}>
        <legend className={styles.h3}>Interview type</legend>
        <label className={styles.mode}>
          <input type="radio" name="mode" value="technical" checked={mode === 'technical'} onChange={() => setMode('technical')} />
          <strong>Technical interview</strong>
          <span className={styles.muted}>8 questions, typed or dictated. Scored on problem solving, depth, design and communication.</span>
        </label>
        <label className={styles.mode}>
          <input type="radio" name="mode" value="trades_voice" checked={mode === 'trades_voice'} onChange={() => setMode('trades_voice')} />
          <strong>Railway & Trades voice interview</strong>
          <span className={styles.muted}>6 spoken questions in your language. Safety comes first in the scoring.</span>
        </label>
      </fieldset>

      <div className={styles.setup}>
        <div className={styles.field}>
          <label htmlFor="iv-domain">{mode === 'technical' ? 'Field' : 'Work area'}</label>
          <select id="iv-domain" className={styles.select} value={domain} onChange={(e) => { setDomain(e.target.value); setSkill(''); }}>
            <option value="">Choose…</option>
            {domains.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="iv-skill">{mode === 'technical' ? 'Skill or role' : 'Role'}</label>
          {mode === 'technical' ? (
            <input id="iv-skill" className={styles.input} value={skill} maxLength={120} placeholder="e.g. Backend engineer (Node.js)" onChange={(e) => setSkill(e.target.value)} />
          ) : (
            <select id="iv-skill" className={styles.select} value={skill} disabled={!domain} onChange={(e) => setSkill(e.target.value)}>
              <option value="">Choose…</option>
              {roles.map((r) => <option key={r.roleId} value={r.label}>{r.label}</option>)}
            </select>
          )}
        </div>
        <div className={styles.field}>
          <label htmlFor="iv-lang">Language</label>
          <select id="iv-lang" className={styles.select} value={language} onChange={(e) => setLanguage(e.target.value)}>
            {catalogue.languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
      </div>

      {mode === 'trades_voice' && (
        <p className={styles.notice}>
          You&apos;ll answer by speaking. Your browser will ask to use the microphone; it is used only on this page while you record.
          {!isSpeechOutputSupported() && ' Your browser cannot read questions aloud, so they will appear as text.'}
        </p>
      )}
      {voiceBlocked && (
        <p className={styles.error} role="alert">Voice interviews need Chrome, Edge or Safari (speech recognition).</p>
      )}

      <div className={styles.row}>
        <Button variant="primary" disabled={!ready || busy} onClick={() => onStart({ mode, domain, skill: skill.trim(), language })}>
          {busy ? 'Starting…' : 'Start interview'}
        </Button>
        {cost !== undefined && <span className={styles.muted}>Uses {cost} credits; refunded automatically if it fails to start.</span>}
      </div>
    </Panel>
  );
}

// ── Runner ───────────────────────────────────────────────────────────────────

function InterviewRunner({ turn, busy, onAnswer, onFinish }: {
  turn: StudioTurnResponse;
  busy: boolean;
  onAnswer: (body: Parameters<typeof careerApi.answer>[1]) => void;
  onFinish: () => void;
}) {
  const voiceOnly = turn.mode === 'trades_voice';
  const locale = speechLocale(turn.language);
  const [text, setText] = useState('');
  const [inputMode, setInputMode] = useState<'text' | 'voice'>(voiceOnly ? 'voice' : 'text');
  const [readAloud, setReadAloud] = useState(voiceOnly);
  const [speaking, setSpeaking] = useState(false);

  // Read each new question aloud (trades by default; technical when switched on).
  useEffect(() => {
    if (!turn.prompt || !readAloud) return;
    setSpeaking(true);
    void speakText(turn.prompt.text, locale).finally(() => setSpeaking(false));
    return () => stopSpeaking();
  }, [turn.prompt, readAloud, locale]);

  useEffect(() => setText(''), [turn.questionNumber]);

  return (
    <Panel className={styles.stack}>
      <div className={styles.between}>
        <span className={styles.row}>
          <Tag color={voiceOnly ? 'gold' : 'default'}>{voiceOnly ? 'Voice interview' : 'Technical interview'}</Tag>
          <span className={styles.muted}>
            {turn.prompt ? `Question ${turn.questionNumber} of ${turn.maxQuestions}` : 'All questions answered'}
          </span>
        </span>
        {isSpeechOutputSupported() && turn.prompt && (
          <span className={styles.row}>
            <Button variantSize="sm" onClick={() => setReadAloud((v) => !v)}>{readAloud ? 'Mute questions' : 'Read questions aloud'}</Button>
            {readAloud && !speaking && (
              <Button variantSize="sm" onClick={() => { setSpeaking(true); void speakText(turn.prompt!.text, locale).finally(() => setSpeaking(false)); }}>Repeat</Button>
            )}
          </span>
        )}
      </div>

      {turn.prompt ? (
        <>
          <p className={styles.prompt} lang={turn.language} aria-live="polite">{turn.prompt.text}</p>

          {!voiceOnly && isDictationSupported() && (
            <div className={styles.row} role="group" aria-label="Answer with">
              <Button variantSize="sm" variant={inputMode === 'text' ? 'primary' : 'default'} onClick={() => setInputMode('text')}>Type</Button>
              <Button variantSize="sm" variant={inputMode === 'voice' ? 'primary' : 'default'} onClick={() => setInputMode('voice')}>Speak</Button>
            </div>
          )}

          {inputMode === 'voice' ? (
            <VoiceAnswer
              key={turn.questionNumber}
              locale={locale}
              disabled={busy || speaking}
              onAnswer={(r) => onAnswer({
                answer: r.transcript, inputMode: 'voice', detectedLanguage: turn.language,
                speech: { durationMs: r.durationMs, ...(r.confidence !== undefined ? { confidence: r.confidence } : {}) },
              })}
            />
          ) : (
            <div className={styles.stack}>
              <label htmlFor="iv-answer" className={styles.h3}>Your answer</label>
              <textarea
                id="iv-answer"
                className={styles.textarea}
                value={text}
                maxLength={4000}
                lang={turn.language}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) onAnswer({ answer: text.trim(), inputMode: 'text' });
                }}
              />
              <div className={styles.between}>
                <span className={styles.muted}>{text.length}/4000 · Ctrl+Enter to send</span>
                <Button variant="primary" disabled={busy || !text.trim()} onClick={() => onAnswer({ answer: text.trim(), inputMode: 'text' })}>
                  {busy ? 'Sending…' : 'Send answer'}
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className={styles.muted}>That was the last question. Finish to see your rubric scores.</p>
      )}

      <div className={styles.between}>
        <span className={styles.muted}>{turn.answersGiven} answered{turn.canComplete ? '' : ' · finish after 3 answers'}</span>
        <Button variant={turn.prompt ? 'default' : 'mint'} disabled={busy || !turn.canComplete} onClick={onFinish}>
          Finish & score
        </Button>
      </div>
    </Panel>
  );
}
