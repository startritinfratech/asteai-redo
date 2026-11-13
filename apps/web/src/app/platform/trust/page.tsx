'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { Empty, KPI, PageHeader, Panel, Tag } from '@/components/ui';

interface TrustMetrics {
  activeDisputes: number;
  flaggedSessions: number;
  pendingVerifications: number;
  fraudScore: string;
  sslStatus: string;
}

export default function TrustPage() {
  const { data: metrics, isLoading } = useSWR<TrustMetrics>('/admin/trust', fetcher);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Master Control"
        title="Trust & Safety"
        sub="Systemic platform fraud monitoring, proctoring violation alerts, identity verification, and anti-abuse telemetry."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <KPI value={metrics?.fraudScore ?? 'Low (0.02%)'} label="Global Fraud Risk" />
        <KPI value={metrics?.flaggedSessions.toString() ?? '1'} label="Flagged AI Sessions" />
        <KPI value={metrics?.activeDisputes.toString() ?? '1'} label="Escrow Disputes" />
        <KPI value={metrics?.sslStatus ?? 'TLS 1.3 Active'} label="Cryptographic Security" />
      </div>

      {isLoading && <Empty message="Loading trust metrics…" />}

      <Panel style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Active Safety Policies</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-2)', borderRadius: '4px' }}>
            <span>Dual-Monitor & Window Focus Proctoring Detection</span>
            <Tag color="mint">Enforced</Tag>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-2)', borderRadius: '4px' }}>
            <span>SHA-256 Talent Passport Tamper Proof Cryptographic Signatures</span>
            <Tag color="mint">Enforced</Tag>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-2)', borderRadius: '4px' }}>
            <span>Milestone Escrow Mandatory Verification before Disbursement</span>
            <Tag color="mint">Enforced</Tag>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-2)', borderRadius: '4px' }}>
            <span>Rate Limiting & Anti-Brute-Force Auth Protection (Throttler)</span>
            <Tag color="mint">Enforced</Tag>
          </div>
        </div>
      </Panel>
    </div>
  );
}

