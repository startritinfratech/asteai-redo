'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { TICKET_STATUSES, type AdminSupportTicket, type TicketStatus } from '@asteai/types';
import { errorMessage, fetcher } from '@/lib/api';
import { useAuthHydrated, useAuthStore } from '@/store/auth';
import { Button, Chips, Empty, PageHeader, Panel, Tag } from '@/components/ui';
import styles from '@/features/gigs/Gigs.module.css';
import { TICKET_STATUS_COLOR, TicketThread } from './HelpDesk';

const STAFF_LABEL: Record<TicketStatus, string> = { open: 'Needs reply', pending_user: 'Waiting on user', resolved: 'Resolved' };

/** /platform/support-queue: the staff side of the help desk. */
export function SupportQueue() {
  const hydrated = useAuthHydrated();
  const isAdmin = useAuthStore((s) => s.user?.role === 'Admin');
  const [status, setStatus] = useState<TicketStatus>('open');
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useSWR<AdminSupportTicket[]>(
    hydrated && isAdmin ? `/admin/support/tickets?status=${status}` : null, fetcher,
  );
  if (!hydrated) return <Empty message="Loading…" />;
  if (!isAdmin) return <Empty message="Admins only." />;

  return (
    <div className={styles.page}>
      <PageHeader eyebrow="Admin" title="Support queue" sub="Oldest first. Your replies are emailed to the user and shown as “ASTEAI Support”." />
      <Chips label="Ticket status" value={status} onChange={(s) => { setStatus(s); setSelected(null); }}
        options={TICKET_STATUSES.map((s) => ({ id: s, label: STAFF_LABEL[s] }))} />
      {selected && <TicketThread id={selected} staff onChanged={() => mutate()} onClose={() => setSelected(null)} />}
      {isLoading && <Empty message="Loading…" />}
      {error && <Empty message={errorMessage(error, 'Could not load the queue.')} />}
      {data && data.length === 0 && <Empty message="Nothing here." />}
      <div className={styles.stack}>
        {data?.map((t) => (
          <Panel key={t.id} className={styles.stack}>
            <div className={styles.between}>
              <b>{t.subject}</b>
              <Tag color={TICKET_STATUS_COLOR[t.status]}>{STAFF_LABEL[t.status]}</Tag>
            </div>
            <div className={styles.between}>
              <span className={styles.muted}>{t.id} · {t.userName || t.userEmail} · {t.categoryId} · updated {new Date(t.updatedAt).toLocaleString('en-IN')}</span>
              <Button variant="sm" onClick={() => setSelected(t.id)}>Open</Button>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
