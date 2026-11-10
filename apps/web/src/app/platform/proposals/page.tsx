'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { Empty, PageHeader, Panel, Tag } from '@/components/ui';

interface ProposalRecord {
  id: string;
  project_id: string;
  project_title?: string;
  price: string;
  days: number;
  note: string;
  status: string;
  created_at: string;
  /** The contract the buyer created for this proposal, once awarded. */
  contract_id: string | null;
}

export default function ProposalsPage() {
  const { data: proposals, error, isLoading } = useSWR<ProposalRecord[]>('/proposals/mine', fetcher);

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
                <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{p.project_title || p.project_id}</span>
                <Tag color={isAwarded ? 'mint' : p.status === 'Rejected' ? 'rose' : 'amber'}>
                  {p.status}
                </Tag>
              </div>

              <div style={{ fontSize: '0.8rem', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                Proposal ID: {p.id} · Submitted {new Date(p.created_at).toLocaleDateString()}
              </div>

              <div style={{ display: 'flex', gap: '14px', fontSize: '0.85rem', color: 'var(--fg-2)', background: 'var(--bg-2)', padding: '8px', borderRadius: '4px' }}>
                <div>Bid: <b>₹{Number(p.price).toLocaleString('en-IN')}</b></div>
                <div>Timeline: <b>{p.days} Days</b></div>
              </div>

              <div style={{ fontSize: '0.85rem', color: 'var(--fg-2)', fontStyle: 'italic' }}>
                &ldquo;{p.note}&rdquo;
              </div>

              {isAwarded && (p.contract_id ? (
                <Link
                  href={`/platform/contracts/${encodeURIComponent(p.contract_id)}`}
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
