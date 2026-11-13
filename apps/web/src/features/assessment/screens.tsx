'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { Button, Eyebrow, Scene } from '@/components/ui';
import type { Item, ShapeSpec, Submit } from './items.types';
import styles from './assessment.module.css';

interface ScreenProps<T extends Item['type']> {
  item: Extract<Item, { type: T }>;
  submit: Submit;
  busy: boolean;
}

/** Draws the current screen. Each screen sends one response through `submit`. */
export function Screen({ item, submit, busy }: { item: Item; submit: Submit; busy: boolean }) {
  // Keyed by item id so per-screen state (a typed answer, a reordered list) starts fresh.
  return <ScreenBody key={item.id} item={item} submit={submit} busy={busy} />;
}

function ScreenBody({ item, submit, busy }: { item: Item; submit: Submit; busy: boolean }) {
  const p = { submit, busy };
  switch (item.type) {
    case 'consent': return <Consent item={item} {...p} />;
    case 'practice': return <Practice item={item} {...p} />;
    case 'matrix': return <Matrix item={item} {...p} />;
    case 'series': return <Series item={item} {...p} />;
    case 'span': return <Span item={item} {...p} />;
    case 'numeric': return <Numeric item={item} {...p} />;
    case 'code': return <Code item={item} {...p} />;
    case 'schematic': return <Schematic item={item} {...p} />;
    case 'dashboard': return <Dashboard item={item} {...p} />;
    case 'triage': return <Triage item={item} {...p} />;
    case 'safety': return <Safety item={item} {...p} />;
    case 'cat': return <Cat item={item} {...p} />;
    case 'sjt': return <Sjt item={item} {...p} />;
    case 'emo': return <Emo item={item} {...p} />;
    case 'codebreak': return <Codebreak item={item} {...p} />;
    case 'prior': return <Prior item={item} {...p} />;
    case 'recovery': return <Recovery item={item} {...p} />;
    case 'selfreport': return <SelfReport item={item} {...p} />;
    case 'debrief': return <Debrief item={item} {...p} />;
    default: return <p className={styles.prompt}>This question type isn&apos;t supported yet. Please contact support.</p>;
  }
}

// ── shared pieces ────────────────────────────────────────────────────────────

function Options<T extends React.ReactNode>({
  options, onPick, busy, mono, label,
}: { options: T[]; onPick: (i: number) => void; busy: boolean; mono?: boolean; label: string }) {
  return (
    <div className={styles.opts} role="group" aria-label={label}>
      {options.map((o, i) => (
        <button key={i} type="button" className={clsx(styles.opt, mono && styles.mono)} disabled={busy} onClick={() => onPick(i)}>
          {o}
        </button>
      ))}
    </div>
  );
}

const choose = (submit: Submit) => (choice: number) => submit({ choice });

function ShapeTile({ s }: { s: ShapeSpec }) {
  const parts = Array.from({ length: s.count }, (_, c) => {
    const cx = s.count === 1 ? 40 : s.count === 2 ? (c ? 56 : 24) : [20, 40, 60][c];
    const r = s.count === 1 ? 20 : s.count === 2 ? 12 : 9;
    const shape =
      s.shape === 'circle' ? <circle cx={cx} cy={40} r={r} /> :
      s.shape === 'square' ? <rect x={cx - r} y={40 - r} width={2 * r} height={2 * r} /> :
      s.shape === 'triangle' ? <polygon points={`${cx},${40 - r} ${cx + r},${40 + r} ${cx - r},${40 + r}`} /> :
      <polygon points={`${cx},${40 - r} ${cx + r},40 ${cx},${40 + r} ${cx - r},40`} />;
    return (
      <g key={c} transform={`rotate(${s.rot} ${cx} 40)`} fill={s.fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={3}>
        {shape}
      </g>
    );
  });
  return <svg viewBox="0 0 80 80" className={styles.tile} aria-hidden="true">{parts}</svg>;
}

const describe = (s: ShapeSpec) =>
  `${s.count} ${s.fill ? 'filled' : 'outlined'} ${s.shape}${s.count > 1 ? 's' : ''}${s.rot ? `, turned ${s.rot}°` : ''}`;

// ── screens ──────────────────────────────────────────────────────────────────

function Consent({ submit, busy }: ScreenProps<'consent'>) {
  return (
    <>
      <Eyebrow>Before you begin</Eyebrow>
      <h2>What this measures, and what it records</h2>
      <p>
        Short tasks on reasoning, on how you handle people, and on how you keep going when a task gets harder.
        Some tasks are designed to be difficult; effort is measured, not only completion.
      </p>
      <p>
        <b>Recorded:</b> your answers and how long each one takes, whether this page leaves the foreground, and pastes.{' '}
        <b>Not recorded:</b> camera, microphone or location.
      </p>
      <p>
        You can pause by leaving the page; it is logged, not penalised. A person reviews any integrity flag before an
        employer sees it. To ask for extra time (+25% or +50%), contact support before you start.
      </p>
      <p className={styles.note}>The voice assistant is turned off while you take the assessment.</p>
      <div className={styles.row}>
        <Button variant="primary" disabled={busy} onClick={() => submit({ consent: true })}>I understand and consent</Button>
        <Link className={styles.link} href="/platform/applications">Not now</Link>
      </div>
    </>
  );
}

function Practice({ item, submit, busy }: ScreenProps<'practice'>) {
  const [picked, setPicked] = useState<number | null>(null);
  const right = picked === item.practice_answer;
  return (
    <>
      <Eyebrow>Practice · not scored</Eyebrow>
      <p className={styles.prompt}>{item.prompt}</p>
      <div className={styles.opts} role="group" aria-label="Practice answers">
        {item.options.map((o, i) => (
          <button
            key={i}
            type="button"
            className={clsx(styles.opt, styles.mono, picked === i && (right ? styles.ok : styles.no))}
            onClick={() => setPicked(i)}
          >
            {o}
          </button>
        ))}
      </div>
      <p className={styles.note} aria-live="polite">
        {picked !== null && (right ? `Correct. ${item.explanation}` : item.explanation)}
      </p>
      <Button variant="primary" disabled={picked === null || busy} onClick={() => submit({})}>Start</Button>
    </>
  );
}

function Matrix({ item, submit, busy }: ScreenProps<'matrix'>) {
  return (
    <>
      <Eyebrow>Reasoning · pattern {['I', 'II', 'III'][item.level - 1]}</Eyebrow>
      <p className={styles.prompt}>Which tile completes the grid?</p>
      <div className={styles.matrix} role="img" aria-label={`Grid: ${item.cells.map(describe).join('; ')}; last tile missing`}>
        {item.cells.map((c, i) => <ShapeTile key={i} s={c} />)}
        <div className={styles.missing}>?</div>
      </div>
      <p className={styles.note}>Rows change one property; columns another.</p>
      <div className={styles.tileOpts} role="group" aria-label="Choices">
        {item.options.map((o, i) => (
          <button key={i} type="button" disabled={busy} onClick={() => submit({ choice: i })} aria-label={`Option ${i + 1}: ${describe(o)}`}>
            <ShapeTile s={o} />
          </button>
        ))}
      </div>
    </>
  );
}

function Series({ item, submit, busy }: ScreenProps<'series'>) {
  return (
    <>
      <Eyebrow>Reasoning · number series</Eyebrow>
      <p className={styles.prompt}>What comes next? <span className={styles.mono}>{item.sequence.join(', ')}, …</span></p>
      <Options options={item.options} onPick={choose(submit)} busy={busy} mono label="Answers" />
    </>
  );
}

function Span({ item, submit, busy }: ScreenProps<'span'>) {
  const [shown, setShown] = useState<number | null>(null);
  const [phase, setPhase] = useState<'show' | 'type'>('show');
  const [value, setValue] = useState('');

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let t = 600;
    item.digits.forEach((d) => {
      timers.push(setTimeout(() => setShown(d), t));
      t += item.show_ms;
      timers.push(setTimeout(() => setShown(null), t));
      t += item.gap_ms;
    });
    timers.push(setTimeout(() => setPhase('type'), t));
    return () => timers.forEach(clearTimeout);
  }, [item]);

  return (
    <>
      <Eyebrow>Working memory</Eyebrow>
      <p className={styles.prompt}>
        Remember the digits, then type them {item.backward ? <b>in reverse</b> : 'in order'}.
      </p>
      {phase === 'show' ? (
        <div className={styles.digit} aria-live="assertive">{shown ?? '·'}</div>
      ) : (
        <form className={styles.row} onSubmit={(e) => { e.preventDefault(); submit({ value }); }}>
          <label className={styles.field}>
            Digits{item.backward ? ' (reversed)' : ''}
            <input
              autoFocus
              className={styles.mono}
              inputMode="numeric"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          <Button type="submit" variant="primary" disabled={busy || !value}>Submit</Button>
        </form>
      )}
    </>
  );
}

function Numeric({ item, submit, busy }: ScreenProps<'numeric'>) {
  return (
    <>
      <Eyebrow>Reasoning · {item.theme} data</Eyebrow>
      <p className={styles.prompt}>Which one showed the largest <b>percentage</b> rise in {item.unit}?</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th /><th>Last month</th><th>This month</th></tr></thead>
          <tbody>
            {item.rows.map((r) => (
              <tr key={r.label}><td>{r.label}</td><td className={styles.num}>{r.last}</td><td className={styles.num}>{r.this}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <Options options={item.options} onPick={choose(submit)} busy={busy} label="Answers" />
    </>
  );
}

function Code({ item, submit, busy }: ScreenProps<'code'>) {
  return (
    <>
      <Eyebrow>Diagnostic · failing test</Eyebrow>
      <p className={styles.prompt}><code>{item.test}</code></p>
      <pre className={styles.code}>
        {item.code.map((line, i) => <div key={i}><span className={styles.ln}>{i + 1}</span>{line}</div>)}
      </pre>
      <Options options={item.options.map((l) => `Line ${l}`)} onPick={choose(submit)} busy={busy} mono label="Lines" />
    </>
  );
}

const WIRES = [
  { d: 'M80 85 L120 85 L120 50 L160 50', label: 'Supply to E-stop' },
  { d: 'M240 50 L280 50 L280 130 L240 130', label: 'E-stop to contactor' },
  { d: 'M160 130 L120 130 L120 85', label: 'Contactor back to supply' },
  { d: 'M280 90 L320 90', label: 'Contactor line to motor' },
  { d: 'M80 100 L300 100 L300 90', label: 'Dashed wire from supply to the motor line', dashed: true },
];

function Schematic({ item, submit, busy }: ScreenProps<'schematic'>) {
  const pick = (i: number) => { if (!busy) submit({ choice: i }); };
  return (
    <>
      <Eyebrow>Safety logic · schematic</Eyebrow>
      <p className={styles.prompt}>The emergency stop must cut the motor. One connection defeats it. Select the faulty wire.</p>
      <svg viewBox="0 0 400 180" className={styles.schematic} role="group" aria-label="Circuit">
        {[['SUPPLY', 20, 70, 60], ['E-STOP', 160, 30, 80], ['CONTACTOR', 160, 110, 80], ['MOTOR', 320, 70, 60]].map(([t, x, y, w]) => (
          <g key={t as string}>
            <rect x={x as number} y={y as number} width={w as number} height={40} className={styles.box} />
            <text x={(x as number) + 8} y={(y as number) + 24} className={styles.boxText}>{t}</text>
          </g>
        ))}
        {WIRES.slice(0, item.wires).map((w, i) => (
          <path
            key={i}
            d={w.d}
            role="button"
            tabIndex={0}
            aria-label={w.label}
            className={clsx(styles.wire, w.dashed && styles.wireDashed)}
            onClick={() => pick(i)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(i); } }}
          />
        ))}
      </svg>
      <p className={styles.note}>The dashed wire was added during last week&apos;s maintenance.</p>
    </>
  );
}

function Dashboard({ item, submit, busy }: ScreenProps<'dashboard'>) {
  return (
    <>
      <Eyebrow>Synthesis · {item.theme} dashboard</Eyebrow>
      <p className={styles.prompt}>
        Overall {item.metric.replace(' %', '')} rose. Which one contributes most to the <b>total</b>, taking volume into account?
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Unit</th><th>{item.metric}</th><th>Volume</th></tr></thead>
          <tbody>
            {item.rows.map((r) => (
              <tr key={r.label}><td>{r.label}</td><td className={styles.num}>{r.rate}</td><td className={styles.num}>{r.volume}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <Options options={item.options} onPick={choose(submit)} busy={busy} label="Answers" />
    </>
  );
}

function Triage({ item, submit, busy }: ScreenProps<'triage'>) {
  return (
    <>
      <Eyebrow>Quick judgement</Eyebrow>
      <p className={styles.prompt}>Someone says: {item.quote}<br />How urgent is this?</p>
      <Options options={item.options} onPick={choose(submit)} busy={busy} label="Urgency" />
    </>
  );
}

function Safety({ item, submit, busy }: ScreenProps<'safety'>) {
  return (
    <>
      <Eyebrow>Safety · mandatory pass/fail</Eyebrow>
      <p className={styles.prompt}>
        In the {item.theme}, you notice a colleague skipping a required safety check because &ldquo;the supervisor is
        waiting&rdquo;. What do you do?
      </p>
      <Options options={item.options} onPick={choose(submit)} busy={busy} label="Responses" />
    </>
  );
}

function Cat({ item, submit, busy }: ScreenProps<'cat'>) {
  return (
    <>
      <Eyebrow>{item.again ? 'Quick sorting · again' : 'Quick sorting'} · {item.index + 1} of {item.of}</Eyebrow>
      <p className={styles.prompt}>Sort this request: <b>{item.request}</b></p>
      <Options options={item.options} onPick={choose(submit)} busy={busy} label="Categories" />
    </>
  );
}

function Sjt({ item, submit, busy }: ScreenProps<'sjt'>) {
  return (
    <>
      <Eyebrow>People · {item.follow_up ? 'follow-up' : 'scene'}</Eyebrow>
      <Scene who={item.who}>{item.say}</Scene>
      <p className={styles.prompt}>{item.question}</p>
      <Options options={item.options} onPick={choose(submit)} busy={busy} label="Responses" />
    </>
  );
}

function Emo({ item, submit, busy }: ScreenProps<'emo'>) {
  return (
    <>
      <Eyebrow>People · reading tone</Eyebrow>
      <p className={styles.prompt}>A colleague writes: {item.message}<br />What are they most likely feeling?</p>
      <Options options={item.options} onPick={choose(submit)} busy={busy} label="Feelings" />
    </>
  );
}

function Codebreak({ item, submit, busy }: ScreenProps<'codebreak'>) {
  const [guess, setGuess] = useState('');
  return (
    <>
      <Eyebrow>Persistence · crack the code</Eyebrow>
      <p className={styles.prompt}>
        A {item.length}-digit lock, digits {item.min_digit}–{item.max_digit}, no repeats. After each guess you learn how
        many digits are <b>in the right place</b>.
      </p>
      <form className={styles.row} onSubmit={(e) => { e.preventDefault(); if (guess.length === item.length) submit({ guess }); }}>
        <label className={styles.field}>
          Your guess
          <input
            autoFocus
            className={clsx(styles.mono, styles.short)}
            inputMode="numeric"
            maxLength={item.length}
            autoComplete="off"
            placeholder="123"
            value={guess}
            onChange={(e) => setGuess(e.target.value.replace(/\D/g, ''))}
          />
        </label>
        <Button type="submit" variant="primary" disabled={busy || guess.length !== item.length}>Try</Button>
        <Button disabled={busy} onClick={() => submit({ give_up: true })}>Give up</Button>
      </form>
      <p className={styles.note}>Attempts: {item.attempts}</p>
      {item.history.length > 0 && (
        <ol className={styles.history} aria-label="Previous guesses">
          {item.history.map((h, i) => <li key={i} className={styles.mono}>{h.guess} → {h.in_place} in place</li>)}
        </ol>
      )}
    </>
  );
}

function Prior({ item, submit, busy }: ScreenProps<'prior'>) {
  const [order, setOrder] = useState(item.order);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };
  return (
    <>
      <Eyebrow>Adaptability · prioritise</Eyebrow>
      {item.update && <Scene who={`Update from ${item.update.who}`}>{item.update.say}</Scene>}
      <p className={styles.prompt}>Put these in the order you would do them, most important first.</p>
      <ol className={styles.lines}>
        {order.map((k, i) => (
          <li key={k} className={styles.line}>
            <span className={styles.n}>{i + 1}</span>
            <span className={styles.grow}>{item.tasks[k]}</span>
            <span className={styles.mv}>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move "${item.tasks[k]}" up`}>↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move "${item.tasks[k]}" down`}>↓</button>
            </span>
          </li>
        ))}
      </ol>
      <Button variant="primary" disabled={busy} onClick={() => submit({ order })}>Confirm order</Button>
    </>
  );
}

function Recovery({ item, submit, busy }: ScreenProps<'recovery'>) {
  return (
    <>
      <Eyebrow>Steadiness · under pressure</Eyebrow>
      <div className={styles.chat}>
        {item.messages.map((m, k) => (
          <div key={k} className={styles.chatPair}>
            <div className={clsx(styles.bub, styles.them)}>{m}</div>
            {item.replies[k] && <div className={clsx(styles.bub, styles.me)}>{item.replies[k]}</div>}
          </div>
        ))}
      </div>
      <p className={styles.prompt}>Your reply:</p>
      <Options options={item.options} onPick={choose(submit)} busy={busy} label="Replies" />
    </>
  );
}

function SelfReport({ item, submit, busy }: ScreenProps<'selfreport'>) {
  return (
    <>
      <Eyebrow>About you · {item.index + 1} of {item.of}</Eyebrow>
      <p className={styles.prompt}>{item.statement}</p>
      <div className={styles.likert} role="group" aria-label="How much is this like you?">
        {item.scale.map((label, k) => (
          <button key={k} type="button" className={styles.opt} disabled={busy} onClick={() => submit({ value: k + 1 })}>
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

function Debrief({ submit, busy }: ScreenProps<'debrief'>) {
  return (
    <>
      <Eyebrow>Debrief</Eyebrow>
      <h2>The hard parts were designed to be hard</h2>
      <p>
        The code-breaking task, the changed plan and the rude messages were engineered. Nobody completes them perfectly.
        What was measured is how long you kept trying, whether you changed approach and how steady you stayed afterwards.
        Your real prospects were never at stake in those screens.
      </p>
      <Button variant="primary" disabled={busy} onClick={() => submit({})}>Finish</Button>
    </>
  );
}
