'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { Empty, PageHeader, Panel, Tag } from '@/components/ui';

interface AuditItem {
  id: string;
  actor_name?: string;
  actor_id?: string;
  role?: string;
  action: string;
  entity: string;
  meta?: string;
  created_at: string;
}

export default function AuditLogPage() {
  const { data: logs, error, isLoading } = useSWR<AuditItem[]>('/admin/audit', fetcher);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Master Control"
        title="Immutable Audit Log"
        sub="Security event log, administrative overrides, access grant modifications, and compliance traceability."
      />

      {isLoading && <Empty message="Loading audit trail…" />}
      {error && <Empty message="Could not load audit log." />}

      <Panel style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {logs && logs.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--fg-3)' }}>
                <th style={{ padding: '8px' }}>Timestamp</th>
                <th style={{ padding: '8px' }}>Actor</th>
                <th style={{ padding: '8px' }}>Role</th>
                <th style={{ padding: '8px' }}>Action</th>
                <th style={{ padding: '8px' }}>Target Entity</th>
                <th style={{ padding: '8px' }}>Metadata / Changes</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((item) => (
                <tr key={item.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '8px', color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
                    {new Date(item.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: '8px', fontWeight: 600 }}>{item.actor_name || item.actor_id || 'System'}</td>
                  <td style={{ padding: '8px' }}><Tag color="grey">{item.role || 'System'}</Tag></td>
                  <td style={{ padding: '8px', fontWeight: 500 }}>{item.action}</td>
                  <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>{item.entity}</td>
                  <td style={{ padding: '8px', color: 'var(--fg-2)', maxWidth: '300px', wordBreak: 'break-word' }}>
                    {item.meta || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty message="No audit records registered." />
        )}
      </Panel>
    </div>
  );
}

