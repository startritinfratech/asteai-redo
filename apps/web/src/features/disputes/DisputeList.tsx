'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { DISPUTE_STATUSES } from '@asteai/types';
import { errorMessage, fetcher } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Empty, Field, PageHeader, Panel, Tag } from '@/components/ui';
import { formatMoney } from '../contracts/terms';
import { disputesKey } from './api';
import { REASON_LABEL, slaLabel, STATUS_LABEL, statusColor } from './terms';
import type { DisputeSummary } from './types';
import styles from './Disputes.module.css';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** /platform/disputes: the caller's disputes; for admins the review queue with a status filter and SLA indicator. */
export function DisputeList() {
  const isAdmin = useAuthStore((s) => s.user?.role) === 'Admin';
  const [status, setStatus] = useState('');
  const { data, error, isLoading } = useSWR<DisputeSummary[]>(disputesKey(isAdmin ? status || undefined : undefined), fetcher);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={isAdmin ? 'Disputes & appeals' : 'Disputes'}
        title={isAdmin ? 'Dispute queue' : 'My disputes'}
        sub={isAdmin
          ? 'Review open disputes, read both sides and decide where the escrow goes.'
          : 'To raise a dispute, open the contract and use “Raise a dispute” on a funded milestone.'}
      />
      <Panel className={styles.stack}>
        {isAdmin && (
          <div className={styles.filters}>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                {DISPUTE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </Field>
          </div>
        )}
        {isLoading && <Empty message="Loading disputes…" />}
        {error && <Empty message={errorMessage(error, 'Could not load disputes.')} />}
        {data && !data.length && <Empty message="No disputes" />}
        {data && data.length > 0 && (
          <ul className={styles.list}>
            {data.map((d) => {
              const sla = slaLabel(d);
              return (
                <li key={d.id}>
                  <Link href={`/platform/disputes/${encodeURIComponent(d.id)}`} className={styles.item}>
                    <div className={styles.between}>
                      <span className={styles.itemTitle}>
                        {d.projectTitle ?? d.contractId ?? d.id}{d.milestoneTitle ? ` · ${d.milestoneTitle}` : ''}
                      </span>
                      <Tag color={statusColor(d.status)}>{STATUS_LABEL[d.status]}</Tag>
                    </div>
                    <div className={styles.row}>
                      <span className={styles.muted}>{REASON_LABEL[d.reasonCode] ?? d.reasonCode}</span>
                      <span className={styles.muted}>{d.raisedByName} vs {d.againstUserName}</span>
                      {d.amountInDispute !== null && <span className={styles.mono}>{formatMoney(d.amountInDispute, d.currency)}</span>}
                      <span className={styles.muted}>{formatDate(d.createdAt)}</span>
                    </div>
                    {sla && <span className={d.overdue ? styles.overdue : styles.muted}>{sla}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
