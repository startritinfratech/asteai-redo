'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { Empty, KPI, PageHeader, Panel, Tag } from '@/components/ui';

interface TenantItem {
  id: string;
  name: string;
  industry: string;
  plan: string;
  credits: number;
  seats: number;
  domain: string;
  sso_enabled: boolean;
  created_at: string;
}

export default function TenantsPage() {
  const { data: tenants, error, isLoading } = useSWR<TenantItem[]>('/tenants', fetcher);

  const totalCredits = tenants?.reduce((sum, t) => sum + (t.credits || 0), 0) ?? 0;
  const totalSeats = tenants?.reduce((sum, t) => sum + (t.seats || 0), 0) ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Master Control"
        title="Tenants & Organizations"
        sub="Multi-tenant cluster governance, subscription plans, SSO enforcement policies, and assessment credits."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <KPI value={tenants?.length.toString() ?? '0'} label="Total Tenants" />
        <KPI value={totalSeats.toString()} label="Total Licensed Seats" />
        <KPI value={totalCredits.toLocaleString('en-IN')} label="Pool Credits Allocated" />
        <KPI value="AWS ap-south-1" label="RDS Multi-Tenant Region" />
      </div>

      {isLoading && <Empty message="Loading tenants catalogue…" />}
      {error && <Empty message="Could not load tenants." />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
        {tenants?.map((t) => (
          <Panel key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '1.05rem' }}>{t.name}</span>
              <Tag color={t.plan === 'Enterprise' ? 'mint' : 'amber'}>{t.plan}</Tag>
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              Tenant ID: {t.id} · Domain: {t.domain || 'none'}
            </div>

            <div style={{ display: 'flex', gap: '12px', fontSize: '0.85rem', color: 'var(--fg-2)', background: 'var(--bg-2)', padding: '8px', borderRadius: '4px' }}>
              <div>Industry: <b>{t.industry}</b></div>
              <div>Seats: <b>{t.seats}</b></div>
              <div>Credits: <b>{t.credits}</b></div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--fg-3)' }}>
                SSO Status: {t.sso_enabled ? <Tag color="mint">SAML SSO Active</Tag> : <Tag color="grey">Local Only</Tag>}
              </span>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

