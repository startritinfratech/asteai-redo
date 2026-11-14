'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { ReqApprovalStatus, Requisition } from '@asteai/types';
import { errorMessage, fetcher } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button, Dialog, Empty, PageHeader, Panel, Tag } from '@/components/ui';
import { HIRE_KEYS, hireApi } from '@/features/hire/api';
import { APPROVAL_TAG } from '@/features/hire/format';
import styles from '@/features/hire/Hire.module.css';

type QueueItem = Requisition & { tenantName: string };
const FILTERS: ReqApprovalStatus[] = ['pending', 'rejected', 'approved'];

/** Admin approval queue: nothing reaches the public job board without passing here. */
export default function ApprovalsPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'Admin');
  const [filter, setFilter] = useState<ReqApprovalStatus>('pending');
  const { data, error, mutate } = useSWR<QueueItem[]>(isAdmin ? HIRE_KEYS.approvals(filter) : null, fetcher);
  const [open, setOpen] = useState<QueueItem | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!isAdmin) return <Empty message="Only AsteAI admins review job postings." />;

  async function decide(decision: 'approve' | 'reject') {
    if (!open) return;
    setBusy(true);
    setMessage(null);
    try {
      if (decision === 'approve') await hireApi.approve(open.id, note.trim() || undefined);
      else await hireApi.reject(open.id, note.trim());
      setMessage({ ok: true, text: `${open.title} ${decision === 'approve' ? 'approved' : 'sent back with your note'}. The owner was emailed.` });
      setOpen(null);
      setNote('');
      void mutate();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err, 'Could not save the decision') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Master Control" title="Job approval queue" sub="Review requisitions before they appear on the public job board." />
      <div className={styles.row} role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <Button key={f} variantSize="sm" variant={filter === f ? 'primary' : 'default'} onClick={() => setFilter(f)}>{APPROVAL_TAG[f].label}</Button>
        ))}
      </div>
      {message && <p className={message.ok ? styles.ok : styles.error} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}

      <Panel className={styles.stack}>
        {error ? <Empty message="Could not load the queue." /> : !data ? <Empty message="Loading…" /> : !data.length ? (
          <Empty message={filter === 'pending' ? 'Nothing waiting for review.' : 'None.'} />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Job</th><th>Company</th><th>Submitted</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.title}</strong><div className={styles.muted}>{r.func} · {r.location || 'Remote/any'} · {r.ownerName}</div></td>
                    <td>{r.tenantName}</td>
                    <td>{r.approval?.submittedAt ? new Date(r.approval.submittedAt).toLocaleString() : '—'}</td>
                    <td><Tag color={APPROVAL_TAG[r.approval?.status ?? 'draft'].color}>{APPROVAL_TAG[r.approval?.status ?? 'draft'].label}</Tag></td>
                    <td>{r.approval?.status === 'pending' && <Button variantSize="sm" variant="primary" onClick={() => { setOpen(r); setNote(''); }}>Review</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Dialog
        open={open !== null}
        onOpenChange={(o) => { if (!o) setOpen(null); }}
        title={open ? `Review: ${open.title}` : ''}
        size="lg"
        footer={(
          <>
            <Button variant="rose" disabled={busy || note.trim().length < 3} onClick={() => { void decide('reject'); }}>Request changes</Button>
            <Button variant="mint" disabled={busy} onClick={() => { void decide('approve'); }}>Approve</Button>
          </>
        )}
      >
        {open && (
          <div className={styles.stack}>
            <p className={styles.muted}>{open.tenantName} · {open.industry} · {open.func} · headcount {open.headcount}</p>
            {open.brief && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{open.brief}</p>}
            {!!open.posting?.requirements.length && <p className={styles.muted}>Requirements: {open.posting.requirements.join(', ')}</p>}
            {!!open.screeningQuestions?.length && (
              <div className={styles.stack}>
                <h3 className={styles.h3}>Screening questions</h3>
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {open.screeningQuestions.map((q) => <li key={q.question}>{q.question}{q.knockout && <Tag color="amber">knockout</Tag>}</li>)}
                </ol>
              </div>
            )}
            <p className={styles.notice}>Check for discriminatory requirements or questions (age, gender, religion, caste…), misleading pay, and spam.</p>
            <div className={styles.field}>
              <label htmlFor="review-note">Note to the employer (required to request changes)</label>
              <textarea id="review-note" className={styles.textarea} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
