'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { SERVICE_STATUSES, type AdminServiceItem, type ServiceStatus } from '@asteai/types';
import { errorMessage, fetcher } from '@/lib/api';
import { useAuthHydrated, useAuthStore } from '@/store/auth';
import { Button, Chips, Empty, Field, PageHeader, Panel, Tag } from '@/components/ui';
import { gigsApi } from './api';
import { inr, SERVICE_STATUS_COLOR, SERVICE_STATUS_LABEL, TIER_LABEL } from './format';
import styles from './Gigs.module.css';

/** Decisions offered per status (mirrors ADMIN_DECISIONS in the API). */
const DECISIONS: Record<ServiceStatus, ('published' | 'rejected')[]> = {
  draft: [], pending: ['published', 'rejected'], published: ['rejected'], paused: ['rejected'], rejected: [],
};

/** /platform/service-approvals: admins publish or reject submitted services. */
export function ServiceApprovals() {
  const hydrated = useAuthHydrated();
  const isAdmin = useAuthStore((s) => s.user?.role === 'Admin');
  const [status, setStatus] = useState<ServiceStatus>('pending');
  const { data, error, isLoading, mutate } = useSWR<AdminServiceItem[]>(
    hydrated && isAdmin ? `/admin/services?status=${status}` : null, fetcher,
  );
  if (!hydrated) return <Empty message="Loading…" />;
  if (!isAdmin) return <Empty message="Admins only." />;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Admin"
        title="Service approvals"
        sub="Published services appear in the public catalogue. A rejection needs a note; the expert sees it."
      />
      <Chips
        label="Service status"
        value={status}
        onChange={setStatus}
        options={SERVICE_STATUSES.filter((s) => s !== 'draft').map((s) => ({ id: s, label: SERVICE_STATUS_LABEL[s] }))}
      />
      {isLoading && <Empty message="Loading…" />}
      {error && <Empty message={errorMessage(error, 'Could not load the queue.')} />}
      {data && data.length === 0 && <Empty message={`No ${SERVICE_STATUS_LABEL[status].toLowerCase()} services.`} />}
      <div className={styles.stack}>
        {data?.map((item) => <QueueItem key={item.id} item={item} onDone={() => mutate()} />)}
      </div>
    </div>
  );
}

function QueueItem({ item, onDone }: { item: AdminServiceItem; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const decisions = DECISIONS[item.status];

  const decide = async (decision: 'published' | 'rejected') => {
    if (decision === 'rejected' && note.trim().length < 5) { setFail('Add a note (5+ characters) for the expert.'); return; }
    setBusy(true);
    setFail(null);
    try {
      await gigsApi.decide(item.id, decision, note.trim() || undefined);
      onDone();
    } catch (err) {
      setFail(errorMessage(err, 'Could not save the decision.'));
      setBusy(false);
    }
  };

  return (
    <Panel className={styles.stack}>
      <div className={styles.between}>
        <span className={styles.h2}>{item.title}</span>
        <Tag color={SERVICE_STATUS_COLOR[item.status]}>{SERVICE_STATUS_LABEL[item.status]}</Tag>
      </div>
      <span className={styles.muted}>{item.expertName} · {item.category}</span>
      <p className={styles.cardText}>{item.summary}</p>
      <p className={styles.note}>{item.description}</p>
      <div className={styles.packages}>
        {item.packages.map((p) => (
          <div key={p.id} className={styles.pkg}>
            <Tag color="gold">{TIER_LABEL[p.tier]}</Tag>
            <b>{p.name}</b>
            <span className={styles.price}>{inr(p.price)}</span>
            <span className={styles.muted}>{p.deliveryDays} days · {p.revisions} revisions</span>
          </div>
        ))}
      </div>
      {decisions.length > 0 && (
        <>
          <Field label="Note to the expert"><textarea rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></Field>
          {fail && <p className={styles.error} role="alert">{fail}</p>}
          <div className={styles.row}>
            {decisions.includes('published') && <Button variant={['sm', 'mint']} disabled={busy} onClick={() => decide('published')}>Publish</Button>}
            {decisions.includes('rejected') && <Button variant={['sm', 'rose']} disabled={busy} onClick={() => decide('rejected')}>{item.status === 'pending' ? 'Reject' : 'Take down'}</Button>}
          </div>
        </>
      )}
    </Panel>
  );
}
