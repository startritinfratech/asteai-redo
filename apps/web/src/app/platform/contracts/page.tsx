'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import type { ContractStatus } from '@asteai/types';
import { useAuthStore } from '@/store/auth';
import { fetcher } from '@/lib/api';
import { Chips, Empty, KPI, PageHeader, Panel, Tag } from '@/components/ui';
import { formatMoney, STATUS_LABEL, statusColor, type ContractSummary } from '@/features/contracts';
import styles from '@/features/contracts/Contracts.module.css';

type Filter = ContractStatus | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending_signature', label: STATUS_LABEL.pending_signature },
  { id: 'active', label: STATUS_LABEL.active },
  { id: 'completed', label: STATUS_LABEL.completed },
  { id: 'cancelled', label: STATUS_LABEL.cancelled },
  { id: 'disputed', label: STATUS_LABEL.disputed },
];

/** The contracts the signed-in user is a party to (admins: all), filterable by status. */
export default function ContractsPage() {
  const user = useAuthStore((s) => s.user);
  const [filter, setFilter] = useState<Filter>('all');
  const key = filter === 'all' ? '/contracts' : `/contracts?status=${encodeURIComponent(filter)}`;
  const { data: contracts, error, isLoading } = useSWR<ContractSummary[]>(key, fetcher);

  // Totals are per currency; the KPIs show INR, the platform default.
  const inr = contracts?.filter((c) => c.currency === 'INR') ?? [];
  const sum = (pick: (c: ContractSummary) => number) => inr.reduce((acc, c) => acc + pick(c), 0);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Marketplace"
        title="Contracts"
        sub="Contracts for awarded proposals: signatures, milestone escrow and releases."
      />

      <div className={styles.kpis}>
        <KPI value={contracts?.length ?? 0} label={filter === 'all' ? 'Contracts' : STATUS_LABEL[filter]} />
        <KPI value={formatMoney(sum((c) => c.totalAmount))} label="Contract value" />
        <KPI value={formatMoney(sum((c) => c.escrowFunded - c.released))} label="Held in escrow" />
        <KPI value={formatMoney(sum((c) => c.released))} label="Released" />
      </div>

      <Chips options={FILTERS} value={filter} onChange={setFilter} label="Filter by status" />

      {isLoading && <Empty message="Loading contracts…" />}
      {error && <Empty message="Could not load contracts." />}
      {contracts && contracts.length === 0 && (
        <Empty
          message={filter === 'all'
            ? 'No contracts yet. When a buyer awards a proposal, they create the contract and it appears here.'
            : `No ${STATUS_LABEL[filter].toLowerCase()} contracts.`}
        />
      )}

      <div className={styles.stack}>
        {contracts?.map((c) => {
          const counterpart = user?.id === c.buyerId
            ? `Expert: ${c.expertName}`
            : user?.id === c.expertId
              ? `Buyer: ${c.buyerName}`
              : `${c.buyerName} → ${c.expertName}`;
          return (
            <Link
              key={c.id}
              href={`/platform/contracts/${encodeURIComponent(c.id)}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <Panel className={styles.stack}>
                <div className={styles.between}>
                  <span className={styles.h2}>{c.title}</span>
                  <Tag color={statusColor(c.status)}>{STATUS_LABEL[c.status] ?? c.status}</Tag>
                </div>
                <div className={styles.between}>
                  <span className={styles.muted}>
                    {counterpart} · <span className={styles.mono}>{c.id}</span> · {c.engagementModel}
                  </span>
                  <span className={styles.mono}>
                    {formatMoney(c.released, c.currency)} released of {formatMoney(c.totalAmount, c.currency)}
                  </span>
                </div>
              </Panel>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
