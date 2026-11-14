'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import type { PublicCreditSettings, ResumeDraft } from '@asteai/types';
import { ApiError, errorMessage, fetcher } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button, Empty, PageHeader, Panel } from '@/components/ui';
import { CAREER_KEYS, careerApi, uploadToS3, type LatestResume } from '@/features/career/api';
import {
  checkResumeFile, draftToProfilePatch, formatBytes, PROFILE_FIELDS, type ProfileField,
} from '@/features/career/format';
import styles from '@/features/career/Career.module.css';

type Upload =
  | { state: 'idle' }
  | { state: 'uploading'; name: string; progress: number }
  | { state: 'uploaded'; uploadId: string; name: string; size: number };

/** Résumé upload (straight to S3) and AI Resume Autofill into a reviewable profile draft. */
export default function ResumePage() {
  const role = useAuthStore((s) => s.user?.role);
  const { data: latest, mutate: mutateLatest } = useSWR<LatestResume | null>(CAREER_KEYS.resume, fetcher);
  const { data: credits } = useSWR<PublicCreditSettings>('/public-settings/credits', fetcher);
  const cost = credits?.costs.find((c) => c.feature === 'expert_autofill')?.cost ?? 15;

  const [upload, setUpload] = useState<Upload>({ state: 'idle' });
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<{ text: string; needsCredits?: boolean } | null>(null);
  const [filling, setFilling] = useState(false);
  const [draft, setDraft] = useState<ResumeDraft | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Show the last parsed draft, or offer autofill on the last upload.
  useEffect(() => {
    if (!latest || upload.state !== 'idle') return;
    if (latest.status === 'parsed' && latest.draft) setDraft(latest.draft);
    if (latest.status !== 'rejected') setUpload({ state: 'uploaded', uploadId: latest.uploadId, name: latest.fileName, size: latest.sizeBytes });
  }, [latest, upload.state]);

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    setDraft(null);
    const checked = checkResumeFile(file);
    if ('error' in checked) {
      setError({ text: checked.error });
      return;
    }
    setUpload({ state: 'uploading', name: file.name, progress: 0 });
    try {
      const ticket = await careerApi.resumeUploadUrl({ fileName: file.name, contentType: checked.contentType, sizeBytes: file.size });
      await uploadToS3(ticket, file, (p) => setUpload({ state: 'uploading', name: file.name, progress: p }));
      setUpload({ state: 'uploaded', uploadId: ticket.uploadId, name: file.name, size: file.size });
      void mutateLatest();
    } catch (err) {
      setUpload({ state: 'idle' });
      setError({ text: errorMessage(err, 'Upload failed') });
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  async function autofill() {
    if (upload.state !== 'uploaded') return;
    setFilling(true);
    setError(null);
    try {
      setDraft((await careerApi.autofill(upload.uploadId)).draft);
      void mutateLatest();
    } catch (err) {
      setError({ text: errorMessage(err, 'Autofill failed'), needsCredits: err instanceof ApiError && err.status === 402 });
    } finally {
      setFilling(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Career Studio"
        title="Résumé & AI Autofill"
        sub="Upload your résumé (PDF or Word, up to 5 MB) and let AI draft your profile for you to review."
      />

      <Panel className={styles.stack}>
        <div
          className={dragging ? `${styles.drop} ${styles.dropActive}` : styles.drop}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); void choose(e.dataTransfer.files[0]); }}
        >
          <strong>Drop your résumé here</strong>
          <span className={styles.muted}>PDF or .docx · up to 5 MB</span>
          <input
            ref={input}
            id="resume-file"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
            onChange={(e) => { void choose(e.target.files?.[0]); }}
          />
          <Button disabled={upload.state === 'uploading'} onClick={() => input.current?.click()}>Choose file</Button>
        </div>

        {upload.state === 'uploading' && (
          <div className={styles.stack}>
            <span className={styles.muted}>Uploading {upload.name}…</span>
            <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(upload.progress * 100)}>
              <span style={{ width: `${Math.round(upload.progress * 100)}%` }} />
            </div>
          </div>
        )}

        {upload.state === 'uploaded' && (
          <div className={styles.between}>
            <span><strong>{upload.name}</strong> <span className={styles.muted}>· {formatBytes(upload.size)} · uploaded</span></span>
            <Button variant="primary" disabled={filling} onClick={() => { void autofill(); }}>
              {filling ? 'Reading your résumé…' : `AI Resume Autofill · ${cost} credits`}
            </Button>
          </div>
        )}
        {upload.state === 'uploaded' && (
          <p className={styles.muted}>Credits are refunded automatically if autofill fails. Nothing is saved until you apply it.</p>
        )}

        {error && (
          <p className={styles.error} role="alert">
            {error.text}
            {error.needsCredits && <> <Link href="/platform/wallet" className={styles.link}>Top up credits</Link></>}
          </p>
        )}
      </Panel>

      {draft ? <DraftReview draft={draft} canApplyToProfile={role === 'Freelancer'} /> : filling ? <Panel><Empty message="Reading your résumé…" /></Panel> : null}
    </>
  );
}

function DraftReview({ draft, canApplyToProfile }: { draft: ResumeDraft; canApplyToProfile: boolean }) {
  const [fields, setFields] = useState<Set<ProfileField>>(() => new Set(PROFILE_FIELDS.map(([k]) => k)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const toggle = (f: ProfileField) => setFields((s) => {
    const n = new Set(s);
    if (n.has(f)) n.delete(f); else n.add(f);
    return n;
  });

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: ok });
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err, 'Could not save') });
    } finally {
      setBusy(false);
    }
  }

  const value = (f: ProfileField): string => {
    if (f === 'links') return Object.values(draft.links).filter(Boolean).join('  ·  ');
    const v = draft[f];
    return Array.isArray(v) ? v.join(', ') : v === null ? '' : String(v);
  };

  return (
    <Panel className={styles.stack}>
      <div className={styles.between}>
        <h2 className={styles.h2}>Review your draft</h2>
        {draft.fullName && <span className={styles.muted}>{draft.fullName}</span>}
      </div>
      <p className={styles.muted}>Untick anything you don&apos;t want to use. AI can misread résumés, so check each field.</p>

      <dl className={styles.dl}>
        {PROFILE_FIELDS.map(([key, label]) => (
          <div key={key} style={{ display: 'contents' }}>
            <dt>
              <label className={styles.row}>
                <input type="checkbox" checked={fields.has(key)} onChange={() => toggle(key)} disabled={!value(key)} />
                {label}
              </label>
            </dt>
            <dd>{value(key) || <span className={styles.muted}>Not found in the résumé</span>}</dd>
          </div>
        ))}
      </dl>

      {draft.experience.length > 0 && (
        <div className={styles.stack}>
          <h3 className={styles.h3}>Experience</h3>
          <ul className={styles.list}>
            {draft.experience.map((e, i) => (
              <li key={i} className={styles.item}>
                <strong>{e.title}{e.organization && ` · ${e.organization}`}</strong>
                <span className={styles.muted}>{[e.start, e.end].filter(Boolean).join(' – ')}</span>
                {e.highlights.length > 0 && <ul>{e.highlights.map((h) => <li key={h}>{h}</li>)}</ul>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {draft.education.length > 0 && (
        <div className={styles.chips}>
          {draft.education.map((e, i) => <span key={i} className={styles.chip}>{[e.qualification, e.institution, e.year].filter(Boolean).join(' · ')}</span>)}
        </div>
      )}

      <div className={styles.row}>
        {canApplyToProfile && (
          <Button variant="primary" disabled={busy || fields.size === 0} onClick={() => { void run(() => careerApi.applyToProfile(draftToProfilePatch(draft, fields)), 'Saved to your profile.'); }}>
            Apply to my profile
          </Button>
        )}
        <Button disabled={busy || !draft.headline} onClick={() => { void run(() => careerApi.updatePassport({ headline: draft.headline }), 'Headline added to your Talent Passport.'); }}>
          Use headline on my passport
        </Button>
      </div>
      {message && <p className={message.ok ? styles.ok : styles.error} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
    </Panel>
  );
}
