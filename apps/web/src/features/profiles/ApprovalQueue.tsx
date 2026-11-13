'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuthHydrated, useAuthStore } from '@/store/auth';
import { Button, Chips, Empty, Field, PageHeader, Panel, Tag, type TagColor } from '@/components/ui';
import { money, STATUS_LABEL } from './format';
import {
  EXPERT_PROFILE_STATUSES, LIMITS,
  type ExpertApprovalItem, type ExpertProfileStatus, type ExpertReviewDecision,
} from './types';
import styles from './profiles.module.css';

interface QueuePage { items: ExpertApprovalItem[]; total: number; page: number; pageSize: number }

const STATUS_COLOR: Record<ExpertProfileStatus, TagColor> = {
  draft: 'grey', pending: 'amber', approved: 'mint', rejected: 'rose', rework: 'gold',
};

/** Decisions offered per status (mirrors ALLOWED_DECISIONS in the API). */
const DECISIONS: Record<ExpertProfileStatus, ExpertReviewDecision[]> = {
  draft: [], pending: ['approved', 'rework', 'rejected'], approved: ['rework', 'rejected'], rejected: [], rework: [],
};

const DECISION_LABEL: Record<ExpertReviewDecision, string> = {
  approved: 'Approve', rework: 'Request changes', rejected: 'Reject',
};

/** /platform/expert-approvals: admins approve, reject or send back expert profiles. */
export function ApprovalQueue() {
  const hydrated = useAuthHydrated();
  const isAdmin = useAuthStore((s) => s.user?.role === 'Admin');
  const [status, setStatus] = useState<ExpertProfileStatus>('pending');
  const [page, setPage] = useState(1);
  const key = hydrated && isAdmin ? `/admin/experts?status=${status}&page=${page}` : null;
  const { data, error, isLoading, mutate } = useSWR<QueuePage>(key, fetcher);

  if (!hydrated) return <Empty message="Loading…" />;
  if (!isAdmin) return <Empty message="Admins only." />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className={styles.stack}>
      <PageHeader
        eyebrow="Admin"
        title="Expert approvals"
        sub="Approved profiles are listed in the public expert directory. Rejections and change requests need a note; the freelancer sees it."
      />
      <Chips
        label="Profile status"
        value={status}
        onChange={(s) => { setStatus(s); setPage(1); }}
        options={EXPERT_PROFILE_STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s] }))}
      />
      {isLoading && <Empty message="Loading…" />}
      {error && <Empty message={errorMessage(error, 'Could not load the queue.')} />}
      {data && data.items.length === 0 && <Empty message={`No ${STATUS_LABEL[status].toLowerCase()} profiles.`} />}
      {data && data.items.length > 0 && (
        <ul className={styles.queue}>
          {data.items.map((item) => (
            <li key={item.userId}>
              <QueueItem item={item} onDone={() => mutate()} />
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className={styles.pager}>
          <Button variant="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</Button>
          <span className={styles.muted}>Page {page} of {pages}</span>
          <Button variant="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</Button>
        </div>
      )}
    </div>
  );
}

function QueueItem({ item, onDone }: { item: ExpertApprovalItem; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<ExpertReviewDecision | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const decisions = DECISIONS[item.status];

  const decide = async (decision: ExpertReviewDecision) => {
    if (decision !== 'approved' && note.trim().length < 5) {
      setErr('Write a note (5+ characters) telling the freelancer what to change.');
      return;
    }
    setBusy(decision);
    setErr(null);
    try {
      await api.patch(`/admin/experts/${encodeURIComponent(item.userId)}/status`, {
        status: decision,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setNote('');
      onDone();
    } catch (e) {
      setErr(errorMessage(e, 'Could not update the profile.'));
    } finally {
      setBusy(null);
    }
  };

  const rate = item.hourlyRate !== null ? `${money(item.hourlyRate, item.currency)}/hr`
    : item.dailyRate !== null ? `${money(item.dailyRate, item.currency)}/day` : null;

  return (
    <Panel className={styles.queueItem}>
      <div className={styles.queueHead}>
        <div>
          <h2>{item.fullName || 'Unnamed freelancer'}</h2>
          <div className={styles.queueMeta}>
            <span>{item.email}</span>
            <span>Completeness {item.completion}%</span>
            {rate && <span>{rate}</span>}
            {item.yearsExperience !== null && <span>{item.yearsExperience} yrs</span>}
            <span>Updated {new Date(item.updatedAt).toLocaleDateString('en-IN')}</span>
          </div>
        </div>
        <Tag color={STATUS_COLOR[item.status]}>{STATUS_LABEL[item.status]}</Tag>
      </div>
      <b>{item.headline || '—'}</b>
      {item.summary && <p className={styles.queueSummary}>{item.summary}</p>}
      {item.skills.length > 0 && (
        <ul className={styles.skills} aria-label="Skills">
          {item.skills.map((s) => <li key={s} className={styles.skill}>{s}</li>)}
        </ul>
      )}
      {item.domains.length > 0 && <p className={styles.muted}>Domains: {item.domains.join(' · ')}</p>}
      <div className={styles.row}>
        {[['Portfolio', item.portfolioUrl], ['LinkedIn', item.linkedinUrl], ['GitHub', item.githubUrl]]
          .filter(([, u]) => u)
          .map(([label, u]) => (
            <a key={label} href={u} target="_blank" rel="noopener noreferrer nofollow">{label}</a>
          ))}
        <Link href={`/experts/${item.userId}`}>Preview profile</Link>
      </div>
      {item.adminNote && <p className={styles.muted}>Last note: {item.adminNote}</p>}
      {decisions.length > 0 && (
        <>
          <Field label="Note to the freelancer (required to reject or request changes)">
            <textarea rows={3} maxLength={LIMITS.adminNote} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className={styles.actions}>
            {decisions.map((d) => (
              <Button
                key={d}
                variant={d === 'approved' ? 'mint' : d === 'rejected' ? 'rose' : 'default'}
                disabled={busy !== null}
                onClick={() => decide(d)}
              >
                {busy === d ? 'Saving…' : DECISION_LABEL[d]}
              </Button>
            ))}
          </div>
        </>
      )}
      <div aria-live="polite">{err && <p className={styles.error}>{err}</p>}</div>
    </Panel>
  );
}
