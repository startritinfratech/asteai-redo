'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { errorMessage } from '@/lib/api';
import { Panel, Button, Tag, Eyebrow, Empty, Field, PageHeader, Chips } from '@/components/ui';
import {
  interviewsApi, statusTag, toNumber,
  type Catalogue, type FieldCategory, type MockInterviewSummary,
} from '@/lib/interviews';
import styles from './studio.module.css';

const fieldLabel = (f: string) => f.replace(' (Frontline)', '');

export default function StudioPage() {
  const { data: cat, error: catError } = useSWR('/interviews/catalogue', () => interviewsApi.catalogue());
  const { data: history, isLoading } = useSWR('/interviews/mock', () => interviewsApi.list());

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Careers & AI Prep"
        title="AI Interview Studio"
        sub="A spoken practice interview with the AI interviewer in your field. You get a report, your EQ / Resilience / Grit scores and a verifiable certificate."
      />

      <div className={styles.stage}>
        {catError && <Empty message={catError.message ?? 'Could not load the interview options'} />}
        {!cat && !catError && <Empty message="Loading…" />}
        {cat && <SetupForm cat={cat} />}

        <Eyebrow>Your interviews</Eyebrow>
        {isLoading && <Empty message="Loading…" />}
        {!isLoading && (!history || history.length === 0) && <Empty message="No interviews yet." />}
        <div className={styles.list}>
          {history?.map((i) => <HistoryItem key={i.id} i={i} />)}
        </div>
      </div>
    </div>
  );
}

function SetupForm({ cat }: { cat: Catalogue }) {
  const router = useRouter();
  const [category, setCategory] = useState<FieldCategory>('tech');
  const [domain, setDomain] = useState('');
  const [skill, setSkill] = useState('');
  const [summary, setSummary] = useState('');
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = useMemo(
    () => (category === 'frontline' ? cat.frontline.map((f) => f.field) : cat.domains[category]),
    [cat, category],
  );
  const roles = category === 'frontline' ? cat.frontline.find((f) => f.field === domain)?.roles ?? [] : [];

  const pickCategory = (c: FieldCategory) => {
    setCategory(c);
    setDomain('');
    setSkill('');
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { interview } = await interviewsApi.start({
        category, domain, skill: skill.trim(), summary: summary.trim() || undefined, language,
      });
      router.push(`/platform/studio/${interview.id}`);
    } catch (e) {
      setError(errorMessage(e, 'Could not start the interview'));
      setBusy(false);
    }
  };

  return (
    <Panel className={styles.stack}>
      <Eyebrow>New interview</Eyebrow>
      <Chips label="Category" options={cat.categories} value={category} onChange={pickCategory} />

      <div className={styles.grid2}>
        <Field label={category === 'frontline' ? 'Field' : 'Domain'}>
          <select
            value={domain}
            onChange={(e) => { setDomain(e.target.value); if (category === 'frontline') setSkill(''); }}
          >
            <option value="">Choose…</option>
            {fields.map((f) => <option key={f} value={f}>{fieldLabel(f)}</option>)}
          </select>
        </Field>

        {category === 'frontline' ? (
          <Field label="Role">
            <select value={skill} onChange={(e) => setSkill(e.target.value)} disabled={!domain}>
              <option value="">Choose…</option>
              {roles.map((r) => <option key={r.roleId} value={r.label}>{r.label}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Skill or job title">
            <input
              value={skill}
              onChange={(e) => setSkill(e.target.value)}
              maxLength={120}
              placeholder={category === 'tech' ? 'e.g. Backend Engineer (Node.js)' : 'e.g. Corporate Lawyer'}
            />
          </Field>
        )}

        <Field label="Language">
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {cat.languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </Field>
      </div>

      <Field label="About you (optional)">
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={1500}
          placeholder="Your experience in a few lines. The interviewer tailors its questions to it."
        />
      </Field>

      <p className={`${styles.small} ${styles.dim}`}>
        Starts with six short questions on how you work (Part 1), then about 15 minutes on your field.
        You will need a microphone and camera.
      </p>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.row}>
        <Button variant="primary" disabled={!domain || skill.trim().length < 2 || busy} onClick={start}>
          {busy ? 'Starting…' : 'Start interview'}
        </Button>
      </div>
    </Panel>
  );
}

function HistoryItem({ i }: { i: MockInterviewSummary }) {
  const tag = statusTag(i.status);
  const score = toNumber(i.overall_score);
  return (
    <Link href={`/platform/studio/${i.id}`} className={styles.item}>
      <div>
        <div className={styles.itemTitle}>{i.skill}</div>
        <div className={`${styles.small} ${styles.dim}`}>
          {fieldLabel(i.domain)} · {new Date(i.started_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
        </div>
      </div>
      <div className={styles.row}>
        {score !== null && <span className={styles.score}>{Math.round(score)}</span>}
        <Tag color={tag.color}>{tag.label}</Tag>
      </div>
    </Link>
  );
}
