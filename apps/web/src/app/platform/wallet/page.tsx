'use client';

import useSWR from 'swr';
import type { LedgerEntry, WalletSummary } from '@asteai/types';
import { fetcher } from '@/lib/api';
import { Button, Empty, KPI, PageHeader, Panel, Tag } from '@/components/ui';

export default function WalletPage() {
  const { data: wallet } = useSWR<WalletSummary>('/ledger/wallet', fetcher);
  const { data: entries } = useSWR<LedgerEntry[]>('/ledger/entries', fetcher);

  const earnedNum = wallet?.earned ?? 0;
  const feesNum = wallet?.fees ?? 0;
  const pendingNum = wallet?.pending ?? 0;
  const available = Math.max(0, earnedNum - feesNum);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Finance & Payouts"
        title="Wallet & Escrow"
        sub="Your earnings, escrow held and platform fees, with the transaction ledger."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <KPI value={`₹${available.toLocaleString('en-IN')}`} label="Available Balance" />
        <KPI value={`₹${pendingNum.toLocaleString('en-IN')}`} label="Escrow Held" />
        <KPI value={`₹${earnedNum.toLocaleString('en-IN')}`} label="Total Gross Volume" />
        <KPI value={`₹${feesNum.toLocaleString('en-IN')}`} label="Platform Fees (5%)" />
      </div>

      <Panel style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Deposit / Add Wallet Funds</h3>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--fg-2)' }}>
          Adding funds to your wallet needs payments, which are not available yet.
        </p>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="mint" disabled>Add funds (coming soon)</Button>
          <span style={{ fontSize: '0.85rem', color: 'var(--fg-3)' }}>
            Top-ups arrive with payments — coming soon.
          </span>
        </div>
      </Panel>

      <Panel style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Recent Ledger Activity</h3>
        {entries && entries.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--fg-3)' }}>
                <th style={{ padding: '8px' }}>Date</th>
                <th style={{ padding: '8px' }}>Reference</th>
                <th style={{ padding: '8px' }}>Description</th>
                <th style={{ padding: '8px' }}>Type</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((tx) => {
                const amt = tx.amount;
                return (
                  <tr key={tx.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px', color: 'var(--fg-3)' }}>{new Date(tx.t).toLocaleDateString()}</td>
                    <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>{tx.id}</td>
                    <td style={{ padding: '8px' }}>{tx.description}</td>
                    <td style={{ padding: '8px' }}><Tag color={amt >= 0 ? 'mint' : 'grey'}>{tx.type}</Tag></td>
                    <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600, color: amt >= 0 ? 'var(--mint)' : 'var(--fg-1)' }}>
                      ₹{Math.abs(amt).toLocaleString('en-IN')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty message="No recent wallet transactions recorded." />
        )}
      </Panel>
    </div>
  );
}

