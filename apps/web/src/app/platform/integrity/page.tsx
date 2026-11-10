'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { api, errorMessage, fetcher } from '@/lib/api';
import { Button, Empty, PageHeader, Panel, Tag } from '@/components/ui';

interface IntegrityItem {
  id: string;
  result_id: string;
  candidate_id: string;
  reason: string;
  status: string;
  resolution?: string;
  fit_score?: number;
  integrity?: string;
  created_at: string;
}

export default function IntegrityPage() {
  const { data, error, isLoading, mutate } = useSWR<IntegrityItem[]>('/assessments/integrity-queue', fetcher);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleResolve(id: string, outcome: 'Cleared' | 'Disqualified') {
    setBusy(true);
    setActionError(null);
    try {
      await api.patch(`/assessments/integrity-queue/${id}/resolve`, {
        resolution: `${outcome}: ${notes.trim() || 'Reviewed by proctor'}`,
      });
      setSelectedId(null);
      setNotes('');
      void mutate();
    } catch (err) {
      setActionError(errorMessage(err, 'Could not resolve item'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Intelligence & Security"
        title="Integrity Queue"
        sub="Sessions flagged by the automated anti-tampering heuristics (window blur, unauthorized pastes, or outlier completion speed)."
      />

      {isLoading && <Empty message="Loading integrity items…" />}
      {error && <Empty message="Could not load integrity queue." />}

      {data && data.length === 0 && (
        <Empty message="Integrity queue is clean. No flagged assessment sessions pending review." />
      )}

      {actionError && <p style={{ color: 'var(--rose)', fontSize: '0.85rem' }}>{actionError}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {data?.map((item) => (
          <Panel key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Flag {item.id}</span>
                <span style={{ marginLeft: '10px', fontSize: '0.8rem', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                  Result ID: {item.result_id} · Candidate: {item.candidate_id}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Tag color={item.integrity === 'High Concern' ? 'rose' : 'amber'}>{item.integrity || 'Review'}</Tag>
                <Tag color={item.status === 'Open' ? 'amber' : 'mint'}>{item.status}</Tag>
              </div>
            </div>

            <div style={{ fontSize: '0.85rem', color: 'var(--fg-2)', background: 'var(--bg-2)', padding: '10px', borderRadius: '4px', border: '1px solid var(--line)' }}>
              <b>Telemetry Flags:</b> {item.reason}
            </div>

            {item.status === 'Open' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                {selectedId === item.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <textarea
                      aria-label="Reviewer notes"
                      placeholder="Add investigation or reviewer notes (e.g., 'Checked screen recording, candidate had dual-monitor notification')..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      style={{ width: '100%', minHeight: '60px', padding: '8px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--bg-1)', color: 'var(--fg-1)' }}
                    />
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <Button variant="mint" disabled={busy} onClick={() => handleResolve(item.id, 'Cleared')}>
                        Clear & Approve Result
                      </Button>
                      <Button variant="rose" disabled={busy} onClick={() => handleResolve(item.id, 'Disqualified')}>
                        Disqualify Session
                      </Button>
                      <Button variant="default" disabled={busy} onClick={() => { setSelectedId(null); setNotes(''); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button variant="sm" onClick={() => { setSelectedId(item.id); setNotes(''); }}>
                      Review & Resolve…
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Panel>
        ))}
      </div>
    </div>
  );
}

