'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import type { ApplicationSummary, IssuedCredential, PassportProfile } from '@asteai/types';
import { errorMessage, fetcher } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button, Empty, KPI, PageHeader, Panel, Tag } from '@/components/ui';
import { CAREER_KEYS, careerApi } from '@/features/career/api';
import { CompetencyBars } from '@/features/career/CompetencyBars';
import {
  applicationTimeline, passportStatus, pendingAssessments, percentileLabel, stageColor, stageProgress,
} from '@/features/career/format';
import { formatDay } from '@/features/credits/format';
import styles from '@/features/career/Career.module.css';

/**
 * Career Command Center: where the candidate's applications stand, which assessments
 * are waiting, and the state of their Verified Talent Passport.
 */
export default function CareerCommandCenter() {
  const role = useAuthStore((s) => s.user?.role);
  const isCandidate = role === 'Candidate';
  const { data: apps, error: appsError } = useSWR<ApplicationSummary[]>(isCandidate ? CAREER_KEYS.applications : null, fetcher);
  const { data: passport, error: passportError, mutate: mutatePassport } = useSWR<PassportProfile>(CAREER_KEYS.passport, fetcher);

  const active = (apps ?? []).filter((a) => a.stage !== 'Rejected' && a.stage !== 'Joined');
  const pending = apps ? pendingAssessments(apps) : [];
  const timeline = apps ? applicationTimeline(apps) : [];
  const status = passportStatus(passport);

  return (
    <>
      <PageHeader
        eyebrow="Career Studio"
        title="Career Command Center"
        sub="Your applications, what's waiting on you, and your Verified Talent Passport."
        actions={<Link href="/platform/career/interview" className={styles.link}>Practise an interview →</Link>}
      />

      <div className={styles.kpis}>
        {isCandidate && <KPI value={apps ? active.length : '—'} label="Active applications" />}
        {isCandidate && <KPI value={apps ? pending.length : '—'} label="Assessments to take" />}
        <KPI value={passport?.overall.score != null ? Math.round(passport.overall.score) : '—'} label="Passport score" />
        <KPI value={passport ? percentileLabel(passport.overall.percentile) : '—'} label="Rank" />
      </div>

      <div className={styles.grid}>
        {isCandidate && (
          <Panel className={styles.stack}>
            <div className={styles.between}>
              <h2 className={styles.h2}>Applications timeline</h2>
              <Link href="/platform/applications" className={styles.link}>All applications</Link>
            </div>
            {appsError ? <Empty message="Could not load your applications." />
              : !apps ? <Empty message="Loading…" />
                : !timeline.length ? <Empty message="No applications yet. Browse jobs to apply." />
                  : (
                    <ol className={styles.timeline}>
                      {timeline.map((e, i) => (
                        <li key={`${e.applicationId}-${e.t}-${i}`}>
                          <span className={styles.row}>
                            <strong>{e.title}</strong>
                            <Tag color={stageColor(e.stage)}>{e.stage}</Tag>
                          </span>
                          <span className={styles.muted}>{formatDay(new Date(e.t).toISOString())}</span>
                        </li>
                      ))}
                    </ol>
                  )}
          </Panel>
        )}

        {isCandidate && (
          <Panel className={styles.stack}>
            <h2 className={styles.h2}>Pending assessments</h2>
            {!apps ? <Empty message={appsError ? 'Could not load your assessments.' : 'Loading…'} />
              : !pending.length ? <Empty message="Nothing waiting. You're up to date." />
                : (
                  <ul className={styles.list}>
                    {pending.map((a) => (
                      <li key={a.id} className={styles.item}>
                        <div className={styles.between}>
                          <strong>{a.requisitionTitle ?? 'Application'}</strong>
                          <Tag color={stageColor(a.stage)}>{a.stage}</Tag>
                        </div>
                        <div className={styles.funnel} aria-hidden="true">
                          <span style={{ width: `${Math.round(stageProgress(a) * 100)}%` }} />
                        </div>
                        <Link href="/platform/assess" className={styles.link}>Take the assessment →</Link>
                      </li>
                    ))}
                  </ul>
                )}
          </Panel>
        )}

        <PassportPanel passport={passport} error={!!passportError} status={status} onChanged={(p) => { void mutatePassport(p, { revalidate: false }); }} />
      </div>
    </>
  );
}

function PassportPanel({ passport, error, status, onChanged }: {
  passport: PassportProfile | undefined;
  error: boolean;
  status: ReturnType<typeof passportStatus>;
  onChanged: (p: PassportProfile) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [issued, setIssued] = useState<IssuedCredential | null>(null);

  async function toggleVisibility() {
    if (!passport) return;
    setBusy(true);
    setMessage(null);
    try {
      onChanged(await careerApi.updatePassport({ visibility: passport.visibility === 'public' ? 'private' : 'public' }));
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err, 'Could not change visibility') });
    } finally {
      setBusy(false);
    }
  }

  async function signSnapshot() {
    setBusy(true);
    setMessage(null);
    try {
      setIssued(await careerApi.issueSnapshot());
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err, 'Could not sign the passport') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className={styles.stack}>
      <div className={styles.between}>
        <h2 className={styles.h2}>Talent Passport</h2>
        {passport && (
          <Tag color={status === 'public' ? 'mint' : status === 'private' ? 'grey' : 'amber'}>
            {status === 'public' ? 'Public' : status === 'private' ? 'Private' : 'No scores yet'}
          </Tag>
        )}
      </div>
      {error ? <Empty message="Could not load your passport." /> : !passport ? <Empty message="Loading…" /> : (
        <>
          {status === 'empty' ? (
            <p className={styles.muted}>
              Your passport fills in from verified results only. Pass a <Link href="/platform/career/challenges" className={styles.link}>code challenge</Link> or
              finish an <Link href="/platform/career/interview" className={styles.link}>AI interview</Link> to earn your first scores.
            </p>
          ) : (
            <CompetencyBars competencies={passport.competencies.slice(0, 5)} />
          )}
          <p className={styles.muted}>
            Address: <span className={styles.mono}>/passport/{passport.slug}</span>
            {passport.visibility === 'public' && <> · <Link href={`/passport/${passport.slug}`} className={styles.link} target="_blank">Open public page</Link></>}
          </p>
          <div className={styles.row}>
            <Button disabled={busy} onClick={() => { void toggleVisibility(); }}>
              {passport.visibility === 'public' ? 'Make private' : 'Make public'}
            </Button>
            <Button variant="primary" disabled={busy || status === 'empty'} onClick={() => { void signSnapshot(); }}>
              Sign a shareable credential
            </Button>
          </div>
          {issued && (
            <p className={styles.ok} role="status">
              Signed. Share code <span className={styles.mono}>{issued.code}</span> or{' '}
              <Link href={`/passport/${passport.slug}?credential=${issued.code}`} className={styles.link}>its verification link</Link>.
            </p>
          )}
          {message && <p className={message.ok ? styles.ok : styles.error} role="alert">{message.text}</p>}
        </>
      )}
    </Panel>
  );
}
