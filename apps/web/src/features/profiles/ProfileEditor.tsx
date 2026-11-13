'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import useSWR from 'swr';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuthHydrated, useAuthStore } from '@/store/auth';
import { Button, Empty, Field, PageHeader, Panel } from '@/components/ui';
import { AVAILABILITY_LABEL, ENGAGEMENT_LABEL } from './format';
import { CompletionMeter, StatusBanner } from './StatusBanner';
import { TagInput } from './TagInput';
import {
  AVAILABILITIES, ENGAGEMENT_MODES, LIMITS,
  type Availability, type BuyerProfile, type EngagementMode, type ExpertProfile, type MyProfile,
} from './types';
import styles from './profiles.module.css';

type Feedback = { kind: 'ok' | 'error'; text: string } | null;

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));
const numText = (v: number | null) => (v === null ? '' : String(v));

/** /platform/profile: the expert editor for Freelancers, the company editor for Buyers. */
export function ProfileEditor() {
  const hydrated = useAuthHydrated();
  const role = useAuthStore((s) => s.user?.role);
  const hasProfile = role === 'Freelancer' || role === 'Buyer';
  const { data, error, isLoading, mutate } = useSWR<MyProfile>(hydrated && hasProfile ? '/profiles/me' : null, fetcher);

  if (!hydrated) return <Empty message="Loading…" />;
  if (!hasProfile) {
    return (
      <>
        <PageHeader eyebrow="Account" title="My profile" />
        <Empty message="Profiles are for freelancers and buyers." />
      </>
    );
  }
  return (
    <>
      <PageHeader
        eyebrow="Account"
        title={role === 'Freelancer' ? 'My expert profile' : 'My company profile'}
        sub={role === 'Freelancer'
          ? 'What buyers see in the expert directory once an admin approves your profile.'
          : 'Tell experts who they will be working with.'}
        actions={data?.kind === 'expert' && data.status === 'approved'
          ? <Link href={`/experts/${data.userId}`}>View public profile</Link>
          : undefined}
      />
      {isLoading && <Empty message="Loading your profile…" />}
      {error && <Empty message={errorMessage(error, 'Could not load your profile.')} />}
      {data?.kind === 'expert' && <ExpertForm profile={data} onSaved={(p) => mutate(p, { revalidate: false })} />}
      {data?.kind === 'buyer' && <BuyerForm profile={data} onSaved={(p) => mutate(p, { revalidate: false })} />}
    </>
  );
}

function ExpertForm({ profile, onSaved }: { profile: ExpertProfile; onSaved: (p: ExpertProfile) => void }) {
  const [form, setForm] = useState(() => toForm(profile));
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  useEffect(() => setForm(toForm(profile)), [profile]);

  const set = <K extends keyof ExpertFormState>(key: K, value: ExpertFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy('save');
    setFeedback(null);
    try {
      const saved = await api.put<ExpertProfile>('/profiles/me', fromForm(form));
      onSaved(saved);
      setFeedback({ kind: 'ok', text: 'Profile saved.' });
      return true;
    } catch (err) {
      setFeedback({ kind: 'error', text: errorMessage(err, 'Could not save your profile.') });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!(await save())) return;
    setBusy('submit');
    try {
      onSaved(await api.post<ExpertProfile>('/profiles/me/submit'));
      setFeedback({ kind: 'ok', text: 'Submitted. An admin will review your profile.' });
    } catch (err) {
      setFeedback({ kind: 'error', text: errorMessage(err, 'Could not submit your profile.') });
    } finally {
      setBusy(null);
    }
  };

  const canSubmit = ['draft', 'rework', 'rejected'].includes(profile.status);
  const toggleMode = (m: EngagementMode) =>
    set('engagementModes', form.engagementModes.includes(m)
      ? form.engagementModes.filter((x) => x !== m)
      : [...form.engagementModes, m]);

  return (
    <form className={styles.editor} onSubmit={save} noValidate>
      <div className={styles.stack}>
        <StatusBanner profile={profile} />

        <Panel className={styles.section}>
          <h2>About you</h2>
          <Field label="Headline">
            <input
              value={form.headline}
              maxLength={LIMITS.headline}
              placeholder="e.g. Computer-vision engineer for edge devices"
              onChange={(e) => set('headline', e.target.value)}
            />
          </Field>
          <span className={styles.count} aria-hidden>{form.headline.length}/{LIMITS.headline}</span>
          <Field label="Summary">
            <textarea
              rows={7}
              value={form.summary}
              maxLength={LIMITS.summary}
              placeholder="What you do, for whom, and results you are proud of."
              onChange={(e) => set('summary', e.target.value)}
            />
          </Field>
          <span className={styles.count} aria-hidden>{form.summary.length}/{LIMITS.summary}</span>
          <div className={`${styles.grid2} ${styles.grid3}`}>
            <Field label="Years of experience">
              <input
                type="number" inputMode="numeric" min={0} max={60}
                value={form.yearsExperience}
                onChange={(e) => set('yearsExperience', e.target.value)}
              />
            </Field>
            <Field label="Location">
              <input value={form.location} maxLength={LIMITS.location} onChange={(e) => set('location', e.target.value)} />
            </Field>
            <Field label="Availability">
              <select value={form.availability} onChange={(e) => set('availability', e.target.value as Availability)}>
                {AVAILABILITIES.map((a) => <option key={a} value={a}>{AVAILABILITY_LABEL[a]}</option>)}
              </select>
            </Field>
          </div>
        </Panel>

        <Panel className={styles.section}>
          <h2>Expertise</h2>
          <p className={styles.muted} id="tags-help">Press Enter or comma after each entry.</p>
          <Field label={`Skills (up to ${LIMITS.skills})`}>
            <TagInput value={form.skills} onChange={(v) => set('skills', v)} max={LIMITS.skills}
              placeholder="e.g. PyTorch" describedBy="tags-help" />
          </Field>
          <Field label={`Domains (up to ${LIMITS.domains})`}>
            <TagInput value={form.domains} onChange={(v) => set('domains', v)} max={LIMITS.domains}
              placeholder="e.g. Robotics" describedBy="tags-help" />
          </Field>
          <Field label={`Languages (up to ${LIMITS.languages})`}>
            <TagInput value={form.languages} onChange={(v) => set('languages', v)} max={LIMITS.languages}
              placeholder="e.g. English" describedBy="tags-help" />
          </Field>
        </Panel>

        <Panel className={styles.section}>
          <h2>Rates &amp; engagement</h2>
          <fieldset className={styles.checks}>
            <legend>How you work</legend>
            {ENGAGEMENT_MODES.map((m) => (
              <label key={m} className={styles.check}>
                <input type="checkbox" checked={form.engagementModes.includes(m)} onChange={() => toggleMode(m)} />
                {ENGAGEMENT_LABEL[m]}
              </label>
            ))}
          </fieldset>
          <div className={`${styles.grid2} ${styles.grid3}`}>
            <Field label={`Hourly rate (${form.currency || 'INR'})`}>
              <input type="number" inputMode="decimal" min={0} step="0.01" value={form.hourlyRate}
                onChange={(e) => set('hourlyRate', e.target.value)} />
            </Field>
            <Field label={`Daily rate (${form.currency || 'INR'})`}>
              <input type="number" inputMode="decimal" min={0} step="0.01" value={form.dailyRate}
                onChange={(e) => set('dailyRate', e.target.value)} />
            </Field>
            <Field label={`Fixed projects from (${form.currency || 'INR'})`}>
              <input type="number" inputMode="decimal" min={0} step="0.01" value={form.fixedFrom}
                onChange={(e) => set('fixedFrom', e.target.value)} />
            </Field>
          </div>
          <Field label="Currency (3-letter code)">
            <input value={form.currency} maxLength={3} autoCapitalize="characters"
              onChange={(e) => set('currency', e.target.value.toUpperCase())} />
          </Field>
        </Panel>

        <Panel className={styles.section}>
          <h2>Links</h2>
          <p className={styles.muted}>https:// links only.</p>
          <div className={styles.grid2}>
            <Field label="Portfolio">
              <input type="url" inputMode="url" value={form.portfolioUrl} maxLength={LIMITS.url}
                placeholder="https://" onChange={(e) => set('portfolioUrl', e.target.value)} />
            </Field>
            <Field label="LinkedIn">
              <input type="url" inputMode="url" value={form.linkedinUrl} maxLength={LIMITS.url}
                placeholder="https://www.linkedin.com/in/…" onChange={(e) => set('linkedinUrl', e.target.value)} />
            </Field>
            <Field label="GitHub">
              <input type="url" inputMode="url" value={form.githubUrl} maxLength={LIMITS.url}
                placeholder="https://github.com/…" onChange={(e) => set('githubUrl', e.target.value)} />
            </Field>
          </div>
        </Panel>
      </div>

      <aside className={styles.aside}>
        <Panel className={styles.section}>
          <CompletionMeter value={profile.completion} />
          <p className={styles.muted}>Recalculated each time you save.</p>
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={busy !== null}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
            {canSubmit && (
              <Button variant="mint" disabled={busy !== null} onClick={submit}>
                {busy === 'submit' ? 'Submitting…' : 'Submit for review'}
              </Button>
            )}
          </div>
          <div aria-live="polite">
            {feedback && <p className={feedback.kind === 'ok' ? styles.ok : styles.error}>{feedback.text}</p>}
          </div>
        </Panel>
      </aside>
    </form>
  );
}

interface ExpertFormState {
  headline: string;
  summary: string;
  skills: string[];
  domains: string[];
  languages: string[];
  yearsExperience: string;
  hourlyRate: string;
  dailyRate: string;
  fixedFrom: string;
  currency: string;
  engagementModes: EngagementMode[];
  availability: Availability;
  location: string;
  portfolioUrl: string;
  linkedinUrl: string;
  githubUrl: string;
}

function toForm(p: ExpertProfile): ExpertFormState {
  return {
    headline: p.headline, summary: p.summary, skills: p.skills, domains: p.domains, languages: p.languages,
    yearsExperience: numText(p.yearsExperience), hourlyRate: numText(p.hourlyRate), dailyRate: numText(p.dailyRate),
    fixedFrom: numText(p.fixedFrom), currency: p.currency, engagementModes: p.engagementModes,
    availability: p.availability, location: p.location, portfolioUrl: p.portfolioUrl, linkedinUrl: p.linkedinUrl,
    githubUrl: p.githubUrl,
  };
}

function fromForm(f: ExpertFormState) {
  return {
    ...f,
    yearsExperience: numOrNull(f.yearsExperience),
    hourlyRate: numOrNull(f.hourlyRate),
    dailyRate: numOrNull(f.dailyRate),
    fixedFrom: numOrNull(f.fixedFrom),
    currency: f.currency.trim() || 'INR',
  };
}

function BuyerForm({ profile, onSaved }: { profile: BuyerProfile; onSaved: (p: BuyerProfile) => void }) {
  const [form, setForm] = useState(profile);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  useEffect(() => setForm(profile), [profile]);

  const set = (key: 'companyName' | 'industry' | 'website' | 'country' | 'about', value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const { companyName, industry, website, country, about } = form;
      onSaved(await api.put<BuyerProfile>('/profiles/me', { companyName, industry, website, country, about }));
      setFeedback({ kind: 'ok', text: 'Profile saved.' });
    } catch (err) {
      setFeedback({ kind: 'error', text: errorMessage(err, 'Could not save your profile.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.editor} onSubmit={save} noValidate>
      <Panel className={styles.section}>
        <h2>Company</h2>
        <div className={styles.grid2}>
          <Field label="Company name">
            <input value={form.companyName} maxLength={160} onChange={(e) => set('companyName', e.target.value)} />
          </Field>
          <Field label="Industry">
            <input value={form.industry} maxLength={120} onChange={(e) => set('industry', e.target.value)} />
          </Field>
          <Field label="Website (https://)">
            <input type="url" inputMode="url" value={form.website} maxLength={LIMITS.url} placeholder="https://"
              onChange={(e) => set('website', e.target.value)} />
          </Field>
          <Field label="Country">
            <input value={form.country} maxLength={80} onChange={(e) => set('country', e.target.value)} />
          </Field>
        </div>
        <Field label="About">
          <textarea rows={6} value={form.about} maxLength={4000} onChange={(e) => set('about', e.target.value)} />
        </Field>
      </Panel>
      <aside className={styles.aside}>
        <Panel className={styles.section}>
          <CompletionMeter value={profile.completion} />
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
          <div aria-live="polite">
            {feedback && <p className={feedback.kind === 'ok' ? styles.ok : styles.error}>{feedback.text}</p>}
          </div>
        </Panel>
      </aside>
    </form>
  );
}
