'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useAuthStore } from '@/store/auth';
import { api, errorMessage, fetcher } from '@/lib/api';
import { Button, Empty, KPI, PageHeader, Panel, Tag } from '@/components/ui';

interface Campaign {
  id: string;
  name: string;
  channel: string;
  sent: number;
  opened: number;
  applied: number;
  status: string;
  created_at: string;
}

export default function OutreachPage() {
  const tenantId = useAuthStore((s) => s.user?.tenantId);
  const { data: campaigns, error, isLoading, mutate } = useSWR<Campaign[]>(
    tenantId ? `/tenants/${encodeURIComponent(tenantId)}/outreach` : null,
    fetcher,
  );

  const [openModal, setOpenModal] = useState(false);
  const [name, setName] = useState('');
  const [channel, setChannel] = useState('Email & WhatsApp');
  const [sentCount, setSentCount] = useState(100);
  const [busy, setBusy] = useState(false);

  const totalSent = campaigns?.reduce((acc, c) => acc + (c.sent || 0), 0) ?? 0;
  const totalOpened = campaigns?.reduce((acc, c) => acc + (c.opened || 0), 0) ?? 0;
  const totalApplied = campaigns?.reduce((acc, c) => acc + (c.applied || 0), 0) ?? 0;
  const convRate = totalSent > 0 ? ((totalApplied / totalSent) * 100).toFixed(1) : '0.0';

  async function handleLaunch(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    try {
      await api.post(`/tenants/${encodeURIComponent(tenantId)}/outreach`, {
        name: name.trim(),
        channel,
        sent: Number(sentCount),
      });
      setName('');
      setOpenModal(false);
      void mutate();
    } catch (err) {
      alert(errorMessage(err, 'Failed to launch campaign'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Hire & ATS"
        title="Bulk Outreach"
        sub="Launch personalized candidate outreach campaigns to talent pools, track message delivery, open rates, and applicant conversions."
        actions={
          <Button variant="primary" onClick={() => setOpenModal(true)}>
            + Launch Campaign
          </Button>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <KPI value={totalSent.toString()} label="Invitations Sent" />
        <KPI value={totalOpened.toString()} label="Messages Opened" />
        <KPI value={totalApplied.toString()} label="Applications Received" />
        <KPI value={`${convRate}%`} label="Conversion Rate" />
      </div>

      {isLoading && <Empty message="Loading campaigns…" />}
      {error && <Empty message="Could not load outreach campaigns." />}

      {openModal && (
        <Panel style={{ display: 'flex', flexDirection: 'column', gap: '14px', border: '1px solid var(--blue)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Launch Outreach Campaign</h3>
          <form onSubmit={handleLaunch} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label htmlFor="outreach-campaign-name" style={{ fontSize: '0.75rem', color: 'var(--fg-3)', display: 'block', marginBottom: '4px' }}>Campaign Name</label>
              <input
                id="outreach-campaign-name"
                type="text"
                required
                placeholder="e.g. Bengaluru Distributed Systems Sourcing Sprint"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--bg-1)', color: 'var(--fg-1)' }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label htmlFor="outreach-delivery-channel" style={{ fontSize: '0.75rem', color: 'var(--fg-3)', display: 'block', marginBottom: '4px' }}>Delivery Channel</label>
                <select
                  id="outreach-delivery-channel"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--bg-1)', color: 'var(--fg-1)' }}
                >
                  <option value="Email & WhatsApp">Email & WhatsApp</option>
                  <option value="Email Only">Email Only</option>
                  <option value="WhatsApp Only">WhatsApp Only</option>
                  <option value="SMS Direct">SMS Direct</option>
                </select>
              </div>
              <div>
                <label htmlFor="outreach-target-audience-count" style={{ fontSize: '0.75rem', color: 'var(--fg-3)', display: 'block', marginBottom: '4px' }}>Target Audience Count</label>
                <input
                  id="outreach-target-audience-count"
                  type="number"
                  min={10}
                  max={5000}
                  value={sentCount}
                  onChange={(e) => setSentCount(Number(e.target.value))}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--bg-1)', color: 'var(--fg-1)' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <Button type="submit" variant="mint" disabled={busy}>Launch Now</Button>
              <Button type="button" onClick={() => setOpenModal(false)}>Cancel</Button>
            </div>
          </form>
        </Panel>
      )}

      {campaigns && campaigns.length === 0 && (
        <Empty message="No active campaigns. Click '+ Launch Campaign' to notify candidates about open requisitions." />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
        {campaigns?.map((c) => (
          <Panel key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{c.name}</span>
              <Tag color="mint">{c.status}</Tag>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              Channel: {c.channel} · ID: {c.id}
            </div>
            <div style={{ display: 'flex', gap: '14px', fontSize: '0.85rem', color: 'var(--fg-2)', background: 'var(--bg-2)', padding: '8px', borderRadius: '4px' }}>
              <div>Sent: <b>{c.sent}</b></div>
              <div>Opened: <b>{c.opened}</b></div>
              <div>Applied: <b>{c.applied}</b></div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

