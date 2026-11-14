'use client';

import { useRef, useState } from 'react';
import useSWR from 'swr';
import { CANDIDATE_TIERS, type CandidateTier, type ReqStatus, type Requisition } from '@asteai/types';
import { api, errorMessage } from '@/lib/api';
import { fetchAllRequisitions } from '@/lib/requisitions';
import { Button, Empty, Eyebrow, Field, KPI, Panel, Tag, type TagColor } from '@/components/ui';
import { useVoiceTargets, type RegisteredTarget } from '@/features/voice-assistant';
import { spokenInteger } from '@/features/voice-assistant/localIntent';
import styles from './requisitions.module.css';

const STATUS_COLOR: Record<ReqStatus, TagColor> = {
  Open: 'mint',
  Paused: 'amber',
  Filled: 'gold',
  Draft: 'grey',
  Closed: 'default',
};

export default function RequisitionsPage() {
  const { data, error, isLoading, mutate } = useSWR('/requisitions?all', fetchAllRequisitions);
  const [creating, setCreating] = useState(false);
  useVoiceTargets(creating ? [] : [{
    id: 'action:requisitions.new', kind: 'action', label: 'New Requisition',
    description: 'Open the form to create a hiring requisition or draft a job.',
    run: () => setCreating(true),
  }]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <Eyebrow>Hire & ATS</Eyebrow>
          <h1>Requisitions</h1>
        </div>
        {!creating && (
          <Button variant="primary" onClick={() => setCreating(true)}>+ New Requisition</Button>
        )}
      </div>

      {creating && (
        <NewRequisitionForm
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void mutate();
          }}
        />
      )}

      {isLoading && <Empty message="Loading…" />}
      {error && <Empty message={error.message} />}
      {data && data.length === 0 && <Empty message="No requisitions yet. Create your first one." />}

      {data && data.length > 0 && (
        <div className={styles.grid}>
          {data.map((req) => <RequisitionCard key={req.id} req={req} />)}
        </div>
      )}
    </div>
  );
}

/** Mirrors CreateRequisitionDto in the API (weights are whole numbers summing to 100). */
function NewRequisitionForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [industry, setIndustry] = useState('');
  const [func, setFunc] = useState('');
  const [echLevel, setEchLevel] = useState(3);
  const [tier, setTier] = useState<CandidateTier>('Technical');
  const [iq, setIq] = useState(40);
  const [eq, setEq] = useState(30);
  const [grit, setGrit] = useState(30);
  const [lang, setLang] = useState('English');
  const [location, setLocation] = useState('');
  const [headcount, setHeadcount] = useState(1);
  const [minShortlist, setMinShortlist] = useState('');
  const [threshold, setThreshold] = useState('');
  const [stack, setStack] = useState('');
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);

  const weightSum = iq + eq + grit;
  const weightsOk = [iq, eq, grit].every((w) => Number.isInteger(w) && w >= 0 && w <= 100) && weightSum === 100;

  async function create() {
    if (submitting.current) return false;
    if (!weightsOk) {
      setFormError('IQ, EQ and Grit weights must be whole numbers that add up to 100.');
      return false;
    }
    if (!form.current?.reportValidity()) return false;
    submitting.current = true;
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/requisitions', {
        title: title.trim(),
        industry: industry.trim(),
        func: func.trim(),
        echLevel,
        tier,
        weights: { iq, eq, grit },
        lang: lang.trim(),
        location: location.trim() || undefined,
        headcount,
        minShortlist: minShortlist ? Number(minShortlist) : undefined,
        threshold: threshold ? Number(threshold) : undefined,
        stack: stack.split(',').map((s) => s.trim()).filter(Boolean),
        brief: brief.trim() || undefined,
      });
      onCreated();
      return true;
    } catch (err) {
      const message = errorMessage(err, 'Could not create the requisition');
      setFormError(message);
      throw new Error(message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const int = (v: string) => (v === '' ? 0 : Math.trunc(Number(v)));
  const fields: RegisteredTarget[] = ([
    ['title', 'Title', 200, setTitle],
    ['industry', 'Industry', 80, setIndustry],
    ['function', 'Function', 80, setFunc],
    ['language', 'Assessment language', 40, setLang],
    ['location', 'Location', 120, setLocation],
    ['brief', 'Brief', 10000, setBrief],
  ] as const).map(([id, label, maxLength, set]) => ({
    id: `field:requisitions.${id}`, kind: 'field', label,
    run: (value) => {
      if (!value?.trim() || value.length > maxLength) throw new Error(`Enter a ${label.toLowerCase()} of up to ${maxLength} characters.`);
      set(value);
    },
  }));
  useVoiceTargets(busy ? [] : [
    ...fields,
    {
      id: 'field:requisitions.headcount', kind: 'field', label: 'Headcount',
      run: (value) => {
        const headcount = spokenInteger(value);
        if (headcount < 1 || headcount > 10000) {
          throw new Error('Enter a headcount between 1 and 10,000.');
        }
        setHeadcount(headcount);
      },
    },
    {
      id: 'action:requisitions.create', kind: 'action', label: 'Create requisition', confirm: true,
      run: async () => {
        if (!(await create())) throw new Error('Check the required fields and assessment weights before creating the requisition.');
      },
    },
  ]);

  return (
    <Panel>
      <form ref={form} onSubmit={(event) => { event.preventDefault(); void create().catch(() => {}); }}
        style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>New Requisition</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <Field label="Title">
            <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Backend Engineer" />
          </Field>
          <Field label="Industry">
            <input required maxLength={80} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Fintech" />
          </Field>
          <Field label="Function">
            <input required maxLength={80} value={func} onChange={(e) => setFunc(e.target.value)} placeholder="e.g. Engineering" />
          </Field>
          <Field label="Level (1–6)">
            <input type="number" required min={1} max={6} step={1} value={echLevel} onChange={(e) => setEchLevel(int(e.target.value))} />
          </Field>
          <Field label="Tier">
            <select value={tier} onChange={(e) => setTier(e.target.value as CandidateTier)}>
              {CANDIDATE_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Assessment language">
            <input required maxLength={40} value={lang} onChange={(e) => setLang(e.target.value)} />
          </Field>
          <Field label="Location (optional)">
            <input maxLength={120} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Bengaluru" />
          </Field>
          <Field label="Headcount">
            <input type="number" required min={1} max={10000} step={1} value={headcount} onChange={(e) => setHeadcount(int(e.target.value))} />
          </Field>
          <Field label="Min shortlist (optional)">
            <input type="number" min={1} max={1000} step={1} value={minShortlist} onChange={(e) => setMinShortlist(e.target.value)} />
          </Field>
          <Field label="Threshold 0–10 (optional)">
            <input type="number" min={0} max={10} step={0.1} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </Field>
        </div>

        <fieldset style={{ border: '1px solid var(--line)', borderRadius: '9px', padding: '10px 12px', margin: 0 }}>
          <legend style={{ fontSize: '.76rem', fontWeight: 600, color: 'var(--fg-2)', padding: '0 4px' }}>
            Weights (must add up to 100; now {weightSum})
          </legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px' }}>
            <Field label="IQ">
              <input type="number" required min={0} max={100} step={1} value={iq} onChange={(e) => setIq(int(e.target.value))} />
            </Field>
            <Field label="EQ">
              <input type="number" required min={0} max={100} step={1} value={eq} onChange={(e) => setEq(int(e.target.value))} />
            </Field>
            <Field label="Grit">
              <input type="number" required min={0} max={100} step={1} value={grit} onChange={(e) => setGrit(int(e.target.value))} />
            </Field>
          </div>
        </fieldset>

        <Field label="Stack (comma separated, optional)">
          <input value={stack} onChange={(e) => setStack(e.target.value)} placeholder="e.g. Go, Postgres, Kafka" />
        </Field>
        <Field label="Brief (optional)">
          <textarea maxLength={10000} value={brief} onChange={(e) => setBrief(e.target.value)} />
        </Field>

        {formError && <p role="alert" style={{ color: 'var(--rose)', fontSize: '0.85rem', margin: 0 }}>{formError}</p>}

        <div style={{ display: 'flex', gap: '10px' }}>
          <Button type="submit" variant="primary" disabled={busy || !weightsOk}>
            {busy ? 'Creating…' : 'Create requisition'}
          </Button>
          <Button type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        </div>
      </form>
    </Panel>
  );
}

function RequisitionCard({ req }: { req: Requisition }) {
  return (
    <Panel className={styles.card}>
      <div className={styles.cardTop}>
        <Tag color={STATUS_COLOR[req.status] ?? 'default'}>{req.status}</Tag>
        <span className={styles.dim}>{req.id}</span>
      </div>
      <h3 className={styles.title}>{req.title}</h3>
      <div className={styles.meta}>
        {[req.industry, req.tier, req.location].filter(Boolean).join(' · ')}
      </div>
      <div className={styles.weights}>
        <WeightBar label="IQ" value={req.weights.iq} />
        <WeightBar label="EQ" value={req.weights.eq} />
        <WeightBar label="Grit" value={req.weights.grit} />
      </div>
      <div className={styles.footer}>
        <KPI value={req.headcount} label="Headcount" />
        <KPI value={req.minShortlist} label="Min shortlist" />
        <KPI value={req.threshold} label="Threshold" />
      </div>
    </Panel>
  );
}

function WeightBar({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.wRow}>
      <span className={styles.wLabel}>{label}</span>
      <div className={styles.wTrack}>
        <div className={styles.wFill} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      <span className={styles.wVal}>{value}</span>
    </div>
  );
}
