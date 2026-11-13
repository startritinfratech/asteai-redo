'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { api, errorMessage, fetcher } from '@/lib/api';
import { Button, Empty, PageHeader, Panel, Tag } from '@/components/ui';

export default function FlagsPage() {
  const { data: flags, isLoading, mutate } = useSWR<Record<string, boolean>>('/admin/flags', fetcher);
  const [busyFlag, setBusyFlag] = useState<string | null>(null);

  async function handleToggle(name: string, currentValue: boolean) {
    setBusyFlag(name);
    try {
      await api.post('/admin/flags', { name, value: !currentValue });
      void mutate();
    } catch (err) {
      alert(errorMessage(err, 'Failed to update feature flag'));
    } finally {
      setBusyFlag(null);
    }
  }

  const flagEntries = flags ? Object.entries(flags) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Master Control"
        title="Feature Flags & Kill-Switches"
        sub="Toggle experimental platform capabilities, manage AI service cut-overs, and enforce system-wide controls without redeployment."
      />

      {isLoading && <Empty message="Loading feature flags…" />}

      <Panel style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Active Platform Flags</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {flagEntries.map(([name, val]) => (
            <div
              key={name}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px',
                background: 'var(--bg-2)',
                borderRadius: '6px',
                border: '1px solid var(--line)',
                flexWrap: 'wrap',
                gap: '10px',
              }}
            >
              <div>
                <span style={{ fontWeight: 600, fontSize: '0.95rem', fontFamily: 'var(--font-mono)' }}>{name}</span>
                <div style={{ marginTop: '4px' }}>
                  <Tag color={val ? 'mint' : 'rose'}>{val ? 'ENABLED' : 'DISABLED'}</Tag>
                </div>
              </div>

              <Button
                variant={val ? 'rose' : 'mint'}
                variantSize="sm"
                disabled={busyFlag === name}
                onClick={() => handleToggle(name, val)}
              >
                {val ? 'Disable Flag' : 'Enable Flag'}
              </Button>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

