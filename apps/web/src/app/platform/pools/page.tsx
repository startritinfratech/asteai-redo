'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useAuthStore } from '@/store/auth';
import { api, errorMessage, fetcher } from '@/lib/api';
import { Button, Empty, Field, PageHeader, Panel, Tag } from '@/components/ui';

interface TalentPool {
  id: string;
  name: string;
  count: number;
  tags: string[];
  created_at: string;
}

export default function PoolsPage() {
  const tenantId = useAuthStore((s) => s.user?.tenantId);
  const { data: pools, error, isLoading, mutate } = useSWR<TalentPool[]>(
    tenantId ? `/tenants/${encodeURIComponent(tenantId)}/pools` : null,
    fetcher,
  );

  const [openModal, setOpenModal] = useState(false);
  const [name, setName] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleCreatePool(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    try {
      const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
      await api.post(`/tenants/${encodeURIComponent(tenantId)}/pools`, {
        // A new pool starts empty; candidates are added to it later.
        name: name.trim(),
        tags,
      });
      setName('');
      setTagsInput('');
      setOpenModal(false);
      void mutate();
    } catch (err) {
      alert(errorMessage(err, 'Failed to create talent pool'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Hire & ATS"
        title="Talent CRM & Pools"
        sub="Organize pre-vetted candidates into specialized skill pools for fast requisitions fulfilment and recurring hiring pipelines."
        actions={
          <Button variant="primary" onClick={() => setOpenModal(true)}>
            + Create Talent Pool
          </Button>
        }
      />

      {isLoading && <Empty message="Loading talent pools…" />}
      {error && <Empty message="Could not load talent pools." />}

      {openModal && (
        <Panel style={{ display: 'flex', flexDirection: 'column', gap: '14px', border: '1px solid var(--blue)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Create New Talent Pool</h3>
          <form onSubmit={handleCreatePool} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Field label="Pool Name">
              <input
                type="text"
                required
                maxLength={120}
                placeholder="e.g. Senior Golang Microservices Engineers"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Competency Tags (comma separated)">
              <input
                type="text"
                placeholder="e.g. Go, Kubernetes, gRPC, Distributed Systems"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
              />
            </Field>
            <div style={{ display: 'flex', gap: '10px' }}>
              <Button type="submit" variant="mint" disabled={busy}>Save Pool</Button>
              <Button type="button" onClick={() => setOpenModal(false)}>Cancel</Button>
            </div>
          </form>
        </Panel>
      )}

      {pools && pools.length === 0 && (
        <Empty message="No talent pools created yet. Click '+ Create Talent Pool' to start grouping candidates." />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
        {pools?.map((p) => (
          <Panel key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '1rem' }}>{p.name}</span>
              <Tag color="mint">{p.count ?? 0} Candidates</Tag>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              ID: {p.id} · Active CRM Pool
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
              {p.tags?.map((tag) => (
                <Tag key={tag} color="grey">{tag}</Tag>
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

