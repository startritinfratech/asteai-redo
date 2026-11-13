'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { AssessmentSessionAdmin, AssessmentSessionStatus } from '@asteai/types';
import { api, errorMessage } from '@/lib/api';
import { Button, Chips, Empty, PageHeader, Panel, Tag, type TagColor } from '@/components/ui';
import styles from './sessions.module.css';

type Filter = 'all' | AssessmentSessionStatus;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'expired', label: 'Expired' },
  { id: 'active', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
  { id: 'reset', label: 'Reset' },
  { id: 'all', label: 'All' },
];

const STATUS: Record<AssessmentSessionStatus, { label: string; color: TagColor }> = {
  active: { label: 'In progress', color: 'amber' },
  completed: { label: 'Completed', color: 'mint' },
  expired: { label: 'Expired', color: 'rose' },
  reset: { label: 'Reset', color: 'grey' },
};

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export default function AssessmentSessionsPage() {
  const [filter, setFilter] = useState<Filter>('expired');
  const { data, error, isLoading, mutate } = useSWR(['/assessments/admin/sessions', filter], () =>
    api.get<AssessmentSessionAdmin[]>('/assessments/admin/sessions', { status: filter === 'all' ? undefined : filter }),
  );

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Master Control"
        title="Assessment Sessions"
        sub="Role-fit assessments by session. Reset an expired or stuck session so the candidate can start again; the old session is kept and the reset is recorded in the audit log."
      />
      <Chips label="Status" options={FILTERS} value={filter} onChange={setFilter} />
      {error && <Empty message={error.message} />}
      {isLoading && <Empty message="Loading…" />}
      {data && data.length === 0 && <Empty message="No sessions." />}
      <div className={styles.list}>
        {data?.map((s) => <SessionRow key={s.id} s={s} onReset={() => mutate()} />)}
      </div>
    </div>
  );
}

function SessionRow({ s, onReset }: { s: AssessmentSessionAdmin; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = STATUS[s.status];
  const resettable = s.status === 'expired' || s.status === 'active';

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/assessments/admin/sessions/${encodeURIComponent(s.id)}/reset`, { reason: reason.trim() });
      setOpen(false);
      onReset();
    } catch (err) {
      setError(errorMessage(err, 'The session could not be reset'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className={styles.row}>
      <div className={styles.main}>
        <div className={styles.title}>{s.candidateName || s.candidateEmail} · {s.requisitionTitle}</div>
        <div className={styles.meta}>
          {s.candidateEmail} · {s.tenantId} · started {when(s.startedAt)}
          {s.completedAt && ` · completed ${when(s.completedAt)}`}
        </div>
        {s.status === 'reset' && (
          <div className={styles.meta}>
            Reset {s.resetAt && when(s.resetAt)}{s.resetByName && ` by ${s.resetByName}`}: {s.resetReason}
          </div>
        )}
        {s.status === 'active' && (
          <div className={styles.meta}>
            Only reset an in-progress session if the candidate is stuck; their current answers are discarded.
          </div>
        )}
      </div>
      <div className={styles.side}>
        <Tag color={status.color}>{status.label}</Tag>
        {resettable && !open && <Button variant="sm" onClick={() => setOpen(true)}>Reset…</Button>}
      </div>

      {open && (
        <form className={styles.form} onSubmit={(e) => { e.preventDefault(); void reset(); }}>
          <label htmlFor={`reason-${s.id}`}>Reason (recorded in the audit log)</label>
          <textarea
            id={`reason-${s.id}`}
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Candidate lost power mid-assessment; confirmed on support ticket"
          />
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.actions}>
            <Button type="submit" variant={['rose', 'sm']} disabled={busy || reason.trim().length < 10}>
              Confirm reset
            </Button>
            <Button variant="sm" disabled={busy} onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
