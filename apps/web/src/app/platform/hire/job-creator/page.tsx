'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import {
  JOB_BANDS, type GeneratedJob, type JobBand, type PublicCreditSettings, type Requisition,
} from '@asteai/types';
import { ApiError, errorMessage, fetcher } from '@/lib/api';
import { Button, Empty, PageHeader, Panel, Tag } from '@/components/ui';
import { HIRE_KEYS, hireApi } from '@/features/hire/api';
import { jobToRequisition, type PublishDetails } from '@/features/hire/format';
import styles from '@/features/hire/Hire.module.css';

const TIERS: PublishDetails['tier'][] = ['Technical', 'Non-Technical', 'Frontline', 'Skilled'];

/** Prompt → job description, screening questions and rubric → one-click requisition. */
export default function JobCreatorPage() {
  const { data: credits } = useSWR<PublicCreditSettings>(HIRE_KEYS.creditCosts, fetcher);
  const cost = credits?.costs.find((c) => c.feature === 'ai_job_creator')?.cost;

  const [prompt, setPrompt] = useState('');
  const [stack, setStack] = useState('');
  const [band, setBand] = useState<JobBand>('mid');
  const [location, setLocation] = useState('');
  const [industry, setIndustry] = useState('');
  const [questions, setQuestions] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; credits?: boolean } | null>(null);
  const [job, setJob] = useState<GeneratedJob | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await hireApi.generateJob({
        rolePrompt: prompt.trim(), band, location: location.trim() || undefined, industry: industry.trim() || undefined,
        stack: stack.split(',').map((s) => s.trim()).filter(Boolean), screeningQuestionCount: questions,
      });
      setJob(res.job);
      setBalance(res.credits.balance);
    } catch (err) {
      setError({ text: errorMessage(err, 'Generation failed'), credits: err instanceof ApiError && err.status === 402 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Hire & ATS"
        title="AI Job Creator"
        sub="Describe the role; get requirements, screening questions and an interview rubric you can edit and publish."
      />
      <Panel className={styles.stack}>
        <div className={styles.form}>
          <div className={`${styles.field} ${styles.wide}`}>
            <label htmlFor="jc-prompt">Describe the role</label>
            <textarea id="jc-prompt" className={styles.textarea} value={prompt} maxLength={2000}
              placeholder="e.g. Backend engineer to own our payments ledger and the Razorpay integration; on-call one week a month."
              onChange={(e) => setPrompt(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="jc-stack">Stack / skills (comma-separated)</label>
            <input id="jc-stack" className={styles.input} value={stack} placeholder="Node.js, PostgreSQL" onChange={(e) => setStack(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="jc-band">Seniority band</label>
            <select id="jc-band" className={styles.select} value={band} onChange={(e) => setBand(e.target.value as JobBand)}>
              {JOB_BANDS.map((b) => <option key={b} value={b}>{b[0].toUpperCase() + b.slice(1)}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="jc-loc">Location (optional)</label>
            <input id="jc-loc" className={styles.input} value={location} maxLength={120} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="jc-ind">Industry (optional)</label>
            <input id="jc-ind" className={styles.input} value={industry} maxLength={80} onChange={(e) => setIndustry(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="jc-q">Screening questions</label>
            <input id="jc-q" type="number" min={3} max={10} className={styles.input} value={questions}
              onChange={(e) => setQuestions(Math.max(3, Math.min(10, Number(e.target.value) || 6)))} />
          </div>
        </div>
        <div className={styles.between}>
          <span className={styles.costBadge} title="Refunded automatically if generation fails">
            Costs <strong>{cost ?? '…'}</strong> credits{balance !== null && <> · balance <strong>{balance}</strong></>}
          </span>
          <Button variant="primary" disabled={busy || prompt.trim().length < 10} onClick={() => { void generate(); }}>
            {busy ? 'Writing the job…' : job ? 'Regenerate' : 'Generate'}
          </Button>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error.text}{error.credits && <> <Link href="/platform/wallet" className={styles.link}>Top up credits</Link></>}
          </p>
        )}
      </Panel>

      {busy && !job && <Panel><Empty message="Writing the job description, screening questions and rubric…" /></Panel>}
      {job && <JobEditor job={job} onChange={setJob} defaults={{ location, industry }} />}
    </>
  );
}

function JobEditor({ job, onChange, defaults }: { job: GeneratedJob; onChange: (j: GeneratedJob) => void; defaults: { location: string; industry: string } }) {
  const [details, setDetails] = useState<PublishDetails>({
    industry: defaults.industry, func: '', tier: 'Technical', lang: 'English', location: defaults.location, headcount: 1,
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Requisition | null>(null);
  const [error, setError] = useState('');

  const rubricTotal = job.evaluationRubric.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const weightsTotal = job.suggestedWeights.iq + job.suggestedWeights.eq + job.suggestedWeights.grit;
  const ready = job.title.trim() && details.industry.trim() && details.func.trim() && rubricTotal === 100 && weightsTotal === 100;

  async function save(publish: boolean) {
    setBusy(true);
    setError('');
    try {
      let req = await hireApi.createRequisition(jobToRequisition(job, details));
      if (publish) {
        req = await hireApi.updateRequisition(req.id, { status: 'Open' });
        // Public + not yet approved = submitted to the admin queue automatically.
        req = await hireApi.setPosting(req.id, { isPublic: true });
      }
      setDone(req);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the requisition'));
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<GeneratedJob>) => onChange({ ...job, ...patch });
  const without = <T,>(list: T[], i: number) => list.filter((_, j) => j !== i);

  return (
    <>
      <Panel className={styles.stack}>
        <div className={styles.field}>
          <label htmlFor="jc-title">Title</label>
          <input id="jc-title" className={styles.input} value={job.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div className={styles.field}>
          <label htmlFor="jc-summary">Summary</label>
          <textarea id="jc-summary" className={styles.textarea} value={job.summary} onChange={(e) => set({ summary: e.target.value })} />
        </div>
        <p className={styles.muted}>
          {job.band.label} · {job.band.yearsMin}{job.band.yearsMax !== null ? `–${job.band.yearsMax}` : '+'} years · {job.stack.join(', ')}
        </p>
        <div className={styles.form}>
          {([['Responsibilities', job.responsibilities, (v: string[]) => set({ responsibilities: v })],
            ['Must have', job.requirements.mustHave, (v: string[]) => set({ requirements: { ...job.requirements, mustHave: v } })],
            ['Nice to have', job.requirements.niceToHave, (v: string[]) => set({ requirements: { ...job.requirements, niceToHave: v } })]] as const).map(([label, list, update]) => (
            <div key={label} className={styles.listEdit}>
              <span className={styles.label}>{label}</span>
              {list.map((x, i) => (
                <div key={`${label}-${i}`} className={styles.listItem}>
                  <span>{x}</span>
                  <button type="button" className={styles.link} aria-label={`Remove ${x}`} onClick={() => update(without([...list], i))}>✕</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Panel>

      <Panel className={styles.stack}>
        <h2 className={styles.h2}>Screening questions</h2>
        {job.screeningQuestions.map((q, i) => (
          <div key={i} className={styles.question}>
            <input className={styles.input} aria-label={`Question ${i + 1}`} value={q.question}
              onChange={(e) => set({ screeningQuestions: job.screeningQuestions.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)) })} />
            <div className={styles.between}>
              <span className={styles.row}>
                <Tag>{q.type.replace('_', ' ')}</Tag>
                {q.options.length > 0 && <span className={styles.muted}>{q.options.join(' / ')}</span>}
                <label className={styles.row}>
                  <input type="checkbox" checked={q.knockout}
                    onChange={(e) => set({ screeningQuestions: job.screeningQuestions.map((x, j) => (j === i ? { ...x, knockout: e.target.checked } : x)) })} />
                  <span className={styles.muted}>Knockout</span>
                </label>
              </span>
              <button type="button" className={styles.link} onClick={() => set({ screeningQuestions: without(job.screeningQuestions, i) })}>Remove</button>
            </div>
            {q.idealAnswer && <p className={styles.muted}>Good answer: {q.idealAnswer}</p>}
          </div>
        ))}
      </Panel>

      <Panel className={styles.stack}>
        <div className={styles.between}>
          <h2 className={styles.h2}>Evaluation rubric</h2>
          <Tag color={rubricTotal === 100 ? 'mint' : 'rose'}>Weights total {rubricTotal}%</Tag>
        </div>
        {job.evaluationRubric.map((c, i) => (
          <div key={i} className={styles.question}>
            <div className={styles.weightRow}>
              <strong>{c.criterion}</strong>
              <input type="number" min={1} max={100} className={styles.input} aria-label={`${c.criterion} weight`} value={c.weight}
                onChange={(e) => set({ evaluationRubric: job.evaluationRubric.map((x, j) => (j === i ? { ...x, weight: Math.round(Number(e.target.value) || 0) } : x)) })} />
            </div>
            {c.strongSignals.length > 0 && <p className={styles.muted}>Strong: {c.strongSignals.join('; ')}</p>}
            {c.weakSignals.length > 0 && <p className={styles.muted}>Weak: {c.weakSignals.join('; ')}</p>}
          </div>
        ))}
        <p className={styles.muted}>
          Assessment weights: cognitive {job.suggestedWeights.iq} · interpersonal {job.suggestedWeights.eq} · persistence {job.suggestedWeights.grit}
        </p>
      </Panel>

      <Panel className={styles.stack}>
        <h2 className={styles.h2}>Publish to Requisitions</h2>
        <div className={styles.form}>
          <div className={styles.field}><label htmlFor="p-ind">Industry</label><input id="p-ind" className={styles.input} value={details.industry} maxLength={80} onChange={(e) => setDetails({ ...details, industry: e.target.value })} /></div>
          <div className={styles.field}><label htmlFor="p-func">Function</label><input id="p-func" className={styles.input} value={details.func} maxLength={80} placeholder="e.g. Engineering" onChange={(e) => setDetails({ ...details, func: e.target.value })} /></div>
          <div className={styles.field}>
            <label htmlFor="p-tier">Track</label>
            <select id="p-tier" className={styles.select} value={details.tier} onChange={(e) => setDetails({ ...details, tier: e.target.value as PublishDetails['tier'] })}>
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className={styles.field}><label htmlFor="p-lang">Assessment language</label><input id="p-lang" className={styles.input} value={details.lang} maxLength={40} onChange={(e) => setDetails({ ...details, lang: e.target.value })} /></div>
          <div className={styles.field}><label htmlFor="p-loc">Location</label><input id="p-loc" className={styles.input} value={details.location} maxLength={120} onChange={(e) => setDetails({ ...details, location: e.target.value })} /></div>
          <div className={styles.field}><label htmlFor="p-hc">Headcount</label><input id="p-hc" type="number" min={1} className={styles.input} value={details.headcount} onChange={(e) => setDetails({ ...details, headcount: Math.max(1, Number(e.target.value) || 1) })} /></div>
        </div>
        {rubricTotal !== 100 && <p className={styles.error}>Rubric weights must add up to 100 (now {rubricTotal}).</p>}
        <div className={styles.row}>
          <Button variant="primary" disabled={!ready || busy || !!done} onClick={() => { void save(true); }}>{busy ? 'Publishing…' : 'Create & publish'}</Button>
          <Button disabled={!ready || busy || !!done} onClick={() => { void save(false); }}>Save as draft</Button>
        </div>
        <p className={styles.muted}>Publishing opens the requisition and sends it for AsteAI review; it appears on the job board once approved.</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {done && (
          <p className={styles.ok} role="status">
            Created {done.id}{done.approval?.status === 'pending' ? ', submitted for approval' : ' as a draft'}. <Link href="/platform/hire" className={styles.link}>See requisitions</Link>
          </p>
        )}
      </Panel>
    </>
  );
}
