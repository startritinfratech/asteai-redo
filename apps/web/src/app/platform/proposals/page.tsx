'use client';

import Link from 'next/link';
import useSWR from 'swr';
import type { Proposal } from '@asteai/types';
import { fetcher } from '@/lib/api';
import { Empty, PageHeader, Panel, Tag } from '@/components/ui';

export default function ProposalsPage() {
  const { data: proposals, error, isLoading } = useSWR<Proposal[]>('/proposals/mine', fetcher);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Marketplace"
        title="My Proposals"
        sub="Track your bids and open the contract for each awarded proposal."
      />

      {isLoading && <Empty message="Loading your submitted proposals…" />}
      {error && <Empty message="Could not load proposals." />}

      {proposals && proposals.length === 0 && (
        <Empty message="You haven't submitted any project proposals yet. Explore 'Find Projects' in the marketplace to start bidding." />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
        {proposals?.map((p) => {
          const isAwarded = p.status === 'Awarded';
          return (
            <Panel key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{p.projectTitle || p.projectId}</span>
                <Tag color={isAwarded ? 'mint' : p.status === 'Pending' ? 'amber' : 'rose'}>
                  {p.status}
                </Tag>
              </div>

              <div style={{ fontSize: '0.8rem', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                Proposal ID: {p.id} · Submitted {new Date(p.createdAt).toLocaleDateString()}
              </div>

              <div style={{ display: 'flex', gap: '14px', fontSize: '0.85rem', color: 'var(--fg-2)', background: 'var(--bg-2)', padding: '8px', borderRadius: '4px' }}>
                <div>Bid: <b>₹{p.price.toLocaleString('en-IN')}</b></div>
                <div>Timeline: <b>{p.days} Days</b></div>
              </div>

              <div style={{ fontSize: '0.85rem', color: 'var(--fg-2)', fontStyle: 'italic' }}>
                &ldquo;{p.note}&rdquo;
              </div>

              {isAwarded && (p.contractId ? (
                <Link
                  href={`/platform/contracts/${encodeURIComponent(p.contractId)}`}

                  style={{ fontSize: '0.85rem', color: 'var(--blue)' }}
                >
                  View contract →
                </Link>
              ) : (
                <div style={{ fontSize: '0.8rem', color: 'var(--fg-3)' }}>
                  Awarded. The buyer will send you a contract to review and sign.
                </div>
              ))}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
