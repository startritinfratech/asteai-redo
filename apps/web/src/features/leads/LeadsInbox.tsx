'use client';

/** /platform/leads: "Submit a requirement" leads from the website, for the sales team. */
import { useState } from 'react';
import useSWR from 'swr';
import { LEAD_STATUSES, type Lead, type LeadStatus } from '@asteai/types';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuthHydrated, useAuthStore } from '@/store/auth';
import { Button, Chips, Empty, PageHeader, Panel, Tag, type TagColor } from '@/components/ui';
import styles from '@/features/gigs/Gigs.module.css';

const LABEL: Record<LeadStatus, string> = { new: 'New', contacted: 'Contacted', qualified: 'Qualified', won: 'Won', lost: 'Lost' };
const COLOR: Record<LeadStatus, TagColor> = { new: 'amber', contacted: 'default', qualified: 'gold', won: 'mint', lost: 'grey' };
const TRACK: Record<Lead['track'], string> = { technical: 'Technical', professional: 'Professional', frontline: 'Frontline & skilled' };
const TIMELINE: Record<Lead['timeline'], string> = { immediate: 'Immediate (< 48 h)', '2weeks': 'Within 2 weeks', flexible: 'Flexible' };

interface LeadPage { items: Lead[]; total: number; page: number; pageSize: number }

export function LeadsInbox() {
  const hydrated = useAuthHydrated();
  const isAdmin = useAuthStore((s) => s.user?.role === 'Admin');
  const [status, setStatus] = useState<LeadStatus>('new');
  const [page, setPage] = useState(1);
  const { data, error, isLoading, mutate } = useSWR<LeadPage>(
    hydrated && isAdmin ? `/admin/leads?status=${status}&page=${page}&pageSize=20` : null, fetcher,
  );
  if (!hydrated) return <Empty message="Loading…" />;
  if (!isAdmin) return <Empty message="Admins only." />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className={styles.page}>
      <PageHeader eyebrow="Growth & Marketing" title="Website leads" sub="Hiring requirements submitted from the website. Each sender got an acknowledgement promising a reply within one business day." />
      <Chips label="Lead status" value={status} onChange={(s) => { setStatus(s); setPage(1); }} options={LEAD_STATUSES.map((s) => ({ id: s, label: LABEL[s] }))} />
      {isLoading && <Empty message="Loading…" />}
      {error && <Empty message={errorMessage(error, 'Could not load leads.')} />}
      {data && data.items.length === 0 && <Empty message={`No ${LABEL[status].toLowerCase()} leads.`} />}
      <div className={styles.stack}>
        {data?.items.map((l) => <LeadCard key={l.id} lead={l} onChanged={() => mutate()} />)}
      </div>
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

function LeadCard({ lead: l, onChanged }: { lead: Lead; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const move = async (status: LeadStatus) => {
    setBusy(true);
    setFail(null);
    try {
      await api.patch(`/admin/leads/${encodeURIComponent(l.id)}`, { status });
      onChanged();
    } catch (err) {
      setFail(errorMessage(err, 'Could not update the lead.'));
      setBusy(false);
    }
  };
  return (
    <Panel className={styles.stack}>
      <div className={styles.between}>
        <b>{l.roleTitle} · {l.company}</b>
        <Tag color={COLOR[l.status]}>{LABEL[l.status]}</Tag>
      </div>
      <span className={styles.muted}>
        {TRACK[l.track]} track · {l.workMode} · {TIMELINE[l.timeline]} · received {new Date(l.createdAt).toLocaleString('en-IN')}
      </span>
      <span>
        {l.contactName} · <a href={`mailto:${l.email}`}>{l.email}</a> · <a href={`tel:${l.phone}`}>{l.phone}</a>
      </span>
      {l.skills && <p className={styles.note} style={{ whiteSpace: 'pre-wrap' }}>{l.skills}</p>}
      {fail && <p className={styles.error} role="alert">{fail}</p>}
      <div className={styles.row}>
        {LEAD_STATUSES.filter((s) => s !== l.status).map((s) => (
          <Button key={s} variant="sm" disabled={busy} onClick={() => move(s)}>Mark {LABEL[s].toLowerCase()}</Button>
        ))}
      </div>
    </Panel>
  );
}
