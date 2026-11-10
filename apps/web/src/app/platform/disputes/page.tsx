'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { Project } from '@asteai/types';
import { useAuthStore } from '@/store/auth';
import { api, errorMessage, fetcher } from '@/lib/api';
import { Button, Empty, Field, PageHeader, Panel, Tag } from '@/components/ui';

interface DisputeItem {
  id: string;
  project_id?: string;
  project_title?: string;
  raised_by: string;
  raised_by_name?: string;
  raised_against: string;
  raised_against_name?: string;
  reason: string;
  status: string;
  resolution?: string;
  timeline?: { date: string; note: string }[];
  created_at: string;
}

export default function DisputesPage() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'Admin';
  // Disputes are between the two parties of an awarded project: its buyer and freelancer.
  const isBuyer = role === 'Buyer';
  const isFreelancer = role === 'Freelancer';
  const canRaise = isBuyer || isFreelancer;

  const { data: disputes, error, isLoading, mutate } = useSWR<DisputeItem[]>('/projects/disputes', fetcher);
  const { data: myProjects } = useSWR<Project[]>(
    isBuyer ? '/projects/mine' : isFreelancer ? '/projects/assigned' : null,
    fetcher,
  );
  // Buyer: their projects that were awarded (counterparty = the freelancer).
  // Freelancer: projects awarded to them (counterparty = the buyer).
  const disputable = (myProjects ?? [])
    .map((p) => ({ project: p, counterparty: isBuyer ? p.awardedTo : p.buyerId }))
    .filter((x): x is { project: Project; counterparty: string } => Boolean(x.counterparty));

  const [openModal, setOpenModal] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionText, setResolutionText] = useState('');

  async function handleFileDispute(e: React.FormEvent) {
    e.preventDefault();
    const target = disputable.find((x) => x.project.id === projectId);
    if (!target) return;
    setBusy(true);
    try {
      await api.post('/projects/disputes', {
        projectId: target.project.id,
        raisedAgainst: target.counterparty,
        reason: reason.trim(),
      });
      setReason('');
      setProjectId('');
      setOpenModal(false);
      void mutate();
    } catch (err) {
      alert(errorMessage(err, 'Failed to file dispute'));
    } finally {
      setBusy(false);
    }
  }

  async function handleResolve(id: string) {
    setBusy(true);
    try {
      await api.patch(`/projects/disputes/${encodeURIComponent(id)}/resolve`, {
        resolution: resolutionText.trim() || 'Arbitrated by platform ops',
      });
      setResolvingId(null);
      setResolutionText('');
      void mutate();
    } catch (err) {
      alert(errorMessage(err, 'Failed to resolve dispute'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Trust & Security"
        title="Disputes & Appeals"
        sub="Escrow arbitration system, contract deliverable claims, and mutual resolution logs."
        actions={
          canRaise && (
            <Button variant="rose" onClick={() => setOpenModal(true)}>
              + Raise Milestone Dispute
            </Button>
          )
        }
      />

      {isLoading && <Empty message="Loading disputes registry…" />}
      {error && <Empty message="Could not load disputes." />}

      {openModal && (
        <Panel style={{ display: 'flex', flexDirection: 'column', gap: '14px', border: '1px solid var(--rose)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>File Contract Dispute</h3>
          <form onSubmit={handleFileDispute} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Field label="Project">
              <select required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">
                  {disputable.length ? 'Select an awarded project…' : 'No awarded projects to dispute'}
                </option>
                {disputable.map(({ project }) => (
                  <option key={project.id} value={project.id}>
                    {project.title} ({project.id})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Dispute reason & specific breach (at least 10 characters)">
              <textarea
                required
                minLength={10}
                maxLength={4000}
                rows={3}
                placeholder="Detail milestone discrepancy, code quality deviation, or deadline violation..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <div style={{ display: 'flex', gap: '10px' }}>
              <Button type="submit" variant="rose" disabled={busy || !projectId || reason.trim().length < 10}>Submit Dispute Claim</Button>
              <Button type="button" onClick={() => setOpenModal(false)}>Cancel</Button>
            </div>
          </form>
        </Panel>
      )}

      {disputes && disputes.length === 0 && (
        <Empty message="No active or pending dispute claims on file." />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {disputes?.map((d) => (
          <Panel key={d.id} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: '1rem' }}>Dispute {d.id}</span>
                <span style={{ marginLeft: '10px', fontSize: '0.8rem', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                  Project: {d.project_title || d.project_id || 'Contract'}
                </span>
              </div>
              <Tag color={d.status === 'Resolved' ? 'mint' : 'rose'}>{d.status}</Tag>
            </div>

            <div style={{ fontSize: '0.85rem', color: 'var(--fg-2)', background: 'var(--bg-2)', padding: '10px', borderRadius: '4px' }}>
              <b>Claim:</b> {d.reason}
            </div>

            {d.resolution && (
              <div style={{ fontSize: '0.85rem', color: 'var(--mint)', background: 'var(--bg-1)', padding: '8px', borderRadius: '4px', border: '1px solid var(--line)' }}>
                <b>Resolution:</b> {d.resolution}
              </div>
            )}

            {isAdmin && d.status !== 'Resolved' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                {resolvingId === d.id ? (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <input
                      type="text"
                      aria-label="Arbitration ruling"
                      placeholder="Enter binding arbitration ruling (e.g., '50% refunded to buyer, 50% released to expert')..."
                      value={resolutionText}
                      onChange={(e) => setResolutionText(e.target.value)}
                      style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--bg-1)', color: 'var(--fg-1)' }}
                    />
                    <Button variant="mint" disabled={busy} onClick={() => handleResolve(d.id)}>Confirm Ruling</Button>
                    <Button onClick={() => setResolvingId(null)}>Cancel</Button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button variant="sm" onClick={() => { setResolvingId(d.id); setResolutionText(''); }}>
                      Arbitrate & Resolve…
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

