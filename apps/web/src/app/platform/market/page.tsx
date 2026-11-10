'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { Project } from '@asteai/types';
import { api, errorMessage, fetcher } from '@/lib/api';
import { Button, Empty, PageHeader, Panel, Tag } from '@/components/ui';

export default function MarketPage() {
  const { data: projects, error, isLoading, mutate } = useSWR<Project[]>('/projects/open', fetcher);

  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [price, setPrice] = useState<number>(50000);
  const [days, setDays] = useState<number>(7);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  async function handleProposal(e: React.FormEvent) {
    e.preventDefault();
    if (!activeProject) return;
    setBusy(true);
    try {
      await api.post('/proposals', {
        projectId: activeProject.id,
        price: Number(price),
        days: Number(days),
        note: note.trim(),
      });
      setSubmittedId(activeProject.id);
      setActiveProject(null);
      setNote('');
      void mutate();
    } catch (err) {
      alert(errorMessage(err, 'Failed to submit proposal'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Marketplace"
        title="Find Projects"
        sub="Browse open technical contracts, apply with your verified Talent Passport credentials, and lock in milestone escrow terms."
      />

      {isLoading && <Empty message="Loading marketplace projects…" />}
      {error && <Empty message="Could not load open projects." />}

      {submittedId && (
        <div style={{ padding: '12px', background: 'var(--bg-2)', border: '1px solid var(--mint)', borderRadius: '6px', fontSize: '0.85rem' }}>
          🎉 <b>Proposal Submitted!</b> Your proposal for project <b>{submittedId}</b> has been delivered to the Buyer.
        </div>
      )}

      {activeProject && (
        <Panel style={{ display: 'flex', flexDirection: 'column', gap: '14px', border: '1px solid var(--blue)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Submit Proposal for: {activeProject.title}</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--fg-2)' }}>{activeProject.description}</p>
          <div style={{ fontSize: '0.85rem', color: 'var(--fg-3)' }}>Budget Cap: ₹{activeProject.budget?.toLocaleString('en-IN')}</div>

          <form onSubmit={handleProposal} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label htmlFor="market-bid-price-inr" style={{ fontSize: '0.75rem', color: 'var(--fg-3)', display: 'block', marginBottom: '4px' }}>Bid Price (INR)</label>
                <input
                  id="market-bid-price-inr"
                  type="number"
                  required
                  min={1000}
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--bg-1)', color: 'var(--fg-1)' }}
                />
              </div>
              <div>
                <label htmlFor="market-estimated-delivery-days" style={{ fontSize: '0.75rem', color: 'var(--fg-3)', display: 'block', marginBottom: '4px' }}>Estimated Delivery (Days)</label>
                <input
                  id="market-estimated-delivery-days"
                  type="number"
                  required
                  min={1}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--bg-1)', color: 'var(--fg-1)' }}
                />
              </div>
            </div>

            <div>
              <label htmlFor="market-proposal-pitch-approach" style={{ fontSize: '0.75rem', color: 'var(--fg-3)', display: 'block', marginBottom: '4px' }}>Proposal Pitch / Approach</label>
              <textarea
                id="market-proposal-pitch-approach"
                required
                rows={3}
                placeholder="Explain your approach, architectural patterns, and previous experience with this stack..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--bg-1)', color: 'var(--fg-1)' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <Button type="submit" variant="mint" disabled={busy}>Submit Proposal</Button>
              <Button type="button" onClick={() => setActiveProject(null)}>Cancel</Button>
            </div>
          </form>
        </Panel>
      )}

      {projects && projects.length === 0 && (
        <Empty message="No open projects currently accepting bids." />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
        {projects?.map((p) => (
          <Panel key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '1rem' }}>{p.title}</span>
              <Tag color="mint">₹{p.budget?.toLocaleString('en-IN')}</Tag>
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              Domain: {p.domain || 'Engineering'} · ID: {p.id}
            </div>

            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--fg-2)', lineHeight: 1.4 }}>
              {p.description}
            </p>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', paddingTop: '8px', borderTop: '1px solid var(--line)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--fg-3)' }}>
                {p.milestones?.length || 0} Milestones
              </span>
              <Button variant="sm" onClick={() => { setActiveProject(p); setPrice(p.budget || 50000); }}>
                Apply / Bid…
              </Button>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

