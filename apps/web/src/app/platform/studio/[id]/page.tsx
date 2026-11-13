'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { errorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Panel, Button, Tag, Eyebrow, Empty, KPI, Bar, PageHeader, Evidence } from '@/components/ui';
import { InterviewRoom } from '@/components/interview/InterviewRoom';
import {
  interviewsApi, downloadCertificate, statusTag, toNumber,
  type MockInterviewDetail, type PartOneResult,
} from '@/lib/interviews';
import styles from '../studio.module.css';

const fieldLabel = (f: string) => f.replace(' (Frontline)', '');

export default function InterviewPage() {
  const { id } = useParams<{ id: string }>();
  const [waiting, setWaiting] = useState(false);
  // Admins reach this page from the AI Interviews list to review a candidate's
  // interview. They must never open (or take over) the candidate's live session.
  const readOnly = useAuthStore((s) => s.user?.role === 'Admin');

  const { data: interview, error, mutate } = useSWR(
    id ? `/interviews/mock/${id}` : null,
    () => interviewsApi.detail(id),
    // After the session ends the result can take a moment to land.
    {
      refreshInterval: (d) =>
        d?.status === 'in_progress' && (waiting || readOnly) ? (readOnly ? 15_000 : 3000) : 0,
    },
  );

  const { data: connection, error: connError } = useSWR(
    !readOnly && interview?.status === 'in_progress' && !waiting ? `/interviews/mock/${id}/session` : null,
    () => interviewsApi.session(id),
    { revalidateOnFocus: false, revalidateIfStale: false },
  );

  const refreshConnection = useCallback(() => interviewsApi.session(id), [id]);
  const onFinished = useCallback(() => { setWaiting(true); void mutate(); }, [mutate]);

  if (error) return <Empty message={error.message ?? 'Interview not found'} />;
  if (!interview) return <Empty message="Loading…" />;

  if (interview.status === 'in_progress' && readOnly) {
    const tag = statusTag(interview.status);
    return (
      <div className={styles.page}>
        <PageHeader
          eyebrow={fieldLabel(interview.domain)}
          title={interview.skill}
          sub={`${new Date(interview.started_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · ${interview.turns} turns`}
          actions={<Tag color={tag.color}>{tag.label}</Tag>}
        />
        <div className={styles.stage}>
          <Empty message="The candidate is still taking this interview. The report appears here once it finishes." />
          <Link href="/platform/ai-interviews" className={styles.small}>← Back to AI Interviews</Link>
        </div>
      </div>
    );
  }

  if (interview.status === 'in_progress') {
    return (
      <div className={styles.page}>
        <PageHeader eyebrow={fieldLabel(interview.domain)} title={interview.skill} />
        <div className={styles.stage}>
          {waiting && <Empty message="Preparing your report… this usually takes under a minute. You can leave and come back." />}
          {!waiting && connError && <Empty message={connError.message ?? 'Could not reach the interviewer'} />}
          {!waiting && connection && (
            <InterviewRoom
              interviewId={interview.id}
              connection={connection}
              refreshConnection={refreshConnection}
              onFinished={onFinished}
            />
          )}
        </div>
      </div>
    );
  }

  return <Report interview={interview} readOnly={readOnly} />;
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function Report({ interview: i, readOnly }: { interview: MockInterviewDetail; readOnly: boolean }) {
  const ps = i.proctoring_summary ?? {};
  const tag = statusTag(i.status);
  const { data: partOne } = useSWR(`/interviews/mock/${i.id}/assessment`, () => interviewsApi.assessment(i.id), {
    refreshInterval: (d) => (d && d.status !== 'scored' && d.status !== 'score_failed' ? 10_000 : 0),
  });
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);

  const download = async () => {
    setDownloading(true);
    setDlError(null);
    try { await downloadCertificate(i.id); } catch (e) { setDlError(errorMessage(e, 'Download failed')); }
    setDownloading(false);
  };

  const score = (v: unknown) => toNumber(v) ?? '—';
  const strengths = strings(ps.strengths);
  const areas = strings(ps.areas_to_improve);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={fieldLabel(i.domain)}
        title={i.skill}
        sub={`${new Date(i.started_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · ${i.turns} turns`}
        actions={
          <>
            <Tag color={tag.color}>{tag.label}</Tag>
            {i.status === 'completed' && (
              <Button variant="primary" onClick={download} disabled={downloading}>
                {downloading ? 'Preparing PDF…' : 'Download certificate'}
              </Button>
            )}
          </>
        }
      />

      <div className={styles.stage}>
        {dlError && <div className={styles.error}>{dlError}</div>}

        {i.status === 'abandoned' && (
          <Empty
            message={
              readOnly
                ? 'This interview did not finish, so there is no report.'
                : 'This interview did not finish, so there is no report. Start a new one from the Studio.'
            }
          />
        )}

        {i.status === 'completed' && (
          <>
            <div className={styles.kpis}>
              <Panel><KPI value={score(ps.overall_score)} label="Overall" /></Panel>
              <Panel><KPI value={score(ps.technical_score)} label="Knowledge & depth" /></Panel>
              <Panel><KPI value={score(ps.communication_score)} label="Communication" /></Panel>
            </div>

            {(typeof ps.summary === 'string' || typeof ps.recommendation === 'string') && (
              <Panel className={styles.stack}>
                {typeof ps.recommendation === 'string' && <div><Tag color="gold">{ps.recommendation}</Tag></div>}
                {typeof ps.summary === 'string' && <p className={styles.muted}>{ps.summary}</p>}
              </Panel>
            )}

            <div className={styles.g2}>
              <Panel className={styles.stack}>
                <Eyebrow>Strengths</Eyebrow>
                {strengths.length ? strengths.map((s) => <Evidence key={s}>{s}</Evidence>) : <Empty message="None recorded" />}
              </Panel>
              <Panel className={styles.stack}>
                <Eyebrow>Areas to improve</Eyebrow>
                {areas.length ? areas.map((s) => <Evidence key={s}>{s}</Evidence>) : <Empty message="None recorded" />}
              </Panel>
            </div>

            <PartOne result={partOne} />

            <Panel className={styles.stack}>
              <Eyebrow>Transcript</Eyebrow>
              <div className={styles.transcript}>
                {(i.conversation ?? []).map((t, n) => (
                  <p key={n} className={styles.turn}>
                    <span className={styles.turnWho}>{t.role === 'assistant' ? 'Interviewer' : readOnly ? 'Candidate' : 'You'}</span>
                    {t.content?.map((c) => c.text).join(' ')}
                  </p>
                ))}
                {(!i.conversation || i.conversation.length === 0) && <Empty message="No transcript was saved." />}
              </div>
            </Panel>
          </>
        )}

        {readOnly ? (
          <Link href="/platform/ai-interviews" className={styles.small}>← Back to AI Interviews</Link>
        ) : (
          <Link href="/platform/studio" className={styles.small}>← Back to the Studio</Link>
        )}
      </div>
    </div>
  );
}

const DIMENSIONS: Array<['eq' | 'resilience' | 'grit', string]> = [
  ['eq', 'EQ'],
  ['resilience', 'Resilience'],
  ['grit', 'Grit'],
];

/** Part 1. Each dimension carries its own scale (Grit 1-5, EQ and Resilience 0-5). */
function PartOne({ result }: { result?: PartOneResult }) {
  const pending = !result || (result.status !== 'scored' && result.status !== 'score_failed');
  return (
    <Panel className={styles.stack}>
      <Eyebrow>Part 1 · EQ, Resilience and Grit</Eyebrow>
      {pending && <Empty message="Being scored. This can take a few minutes after the interview." />}
      {result?.status === 'score_failed' && <Empty message="Part 1 could not be fully scored for this interview." />}
      {!pending && result?.result && DIMENSIONS.map(([key, label]) => {
        const dim = result.result?.[key] ?? {};
        const value = toNumber(dim.score);
        const max = Number(String(dim.scale ?? '0-5').split('-')[1]) || 5;
        return (
          <div key={key} className={styles.stack} style={{ gap: 4 }}>
            <div className={styles.scoreRow}>
              <span>{label}</span>
              {value !== null ? <Bar value={value} max={max} variant="g" /> : <span className={`${styles.small} ${styles.dim}`}>Not scored</span>}
              <span className={styles.scoreVal}>{value !== null ? `${value}/${max}` : '—'}</span>
            </div>
            {typeof dim.evidence === 'string' && dim.evidence && <Evidence>{dim.evidence}</Evidence>}
          </div>
        );
      })}
    </Panel>
  );
}
