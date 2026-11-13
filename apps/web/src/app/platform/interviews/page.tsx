'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import type { Catalogue } from '@/lib/interviews';
import { Button, Empty, Field, PageHeader, Panel, Tag } from '@/components/ui';

export default function InterviewsPage() {
  const { data: catalogue, isLoading, error } = useSWR<Catalogue>('/interviews/catalogue', fetcher);
  const [offerCandidate, setOfferCandidate] = useState('');
  const [offerSalary, setOfferSalary] = useState('');

  const tech = catalogue?.domains?.tech ?? [];
  const nonTech = catalogue?.domains?.['non-tech'] ?? [];
  const frontline = catalogue?.frontline ?? [];
  const languages = catalogue?.languages ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Hire & ATS"
        title="Interviews & Offers"
        sub="Structured AI interview tracks available on the platform, and a draft offer letter workspace."
      />

      <Panel style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Offer Letter Draft</h3>
          <Tag color="amber">Coming soon</Tag>
        </div>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--fg-2)' }}>
          Sending offer letters is not available yet. You can note the details here, but nothing is saved or sent to the candidate.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          <Field label="Candidate Name / Email">
            <input
              type="text"
              placeholder="e.g. Rahul Gowda"
              value={offerCandidate}
              onChange={(e) => setOfferCandidate(e.target.value)}
            />
          </Field>
          <Field label="Annual CTC / Salary (INR)">
            <input
              type="text"
              placeholder="e.g. ₹6,50,000"
              value={offerSalary}
              onChange={(e) => setOfferSalary(e.target.value)}
            />
          </Field>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <Button variant="mint" disabled>
            Send Offer Letter (coming soon)
          </Button>
        </div>
      </Panel>

      <h3 style={{ margin: '10px 0 0', fontSize: '1.1rem', fontWeight: 600 }}>Structured Interview Tracks</h3>
      {isLoading && <Empty message="Loading interview tracks…" />}
      {error && <Empty message="Could not load the interview catalogue." />}

      {catalogue && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
          <TrackPanel title="Technical" tag="Tech" items={tech} />
          <TrackPanel title="Non-technical" tag="Non-tech" items={nonTech} />
          {frontline.map((f) => (
            <TrackPanel
              key={f.field}
              title={f.field}
              tag={f.group || 'Frontline'}
              items={f.roles.map((r) => r.label)}
            />
          ))}
          {languages.length > 0 && (
            <TrackPanel title="Interview languages" tag="Languages" items={languages.map((l) => l.label)} />
          )}
        </div>
      )}
    </div>
  );
}

function TrackPanel({ title, tag, items }: { title: string; tag: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <Panel style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{title}</span>
        <Tag color="mint">{tag}</Tag>
      </div>
      <ul style={{ margin: '0 0 0 16px', padding: 0, fontSize: '0.85rem', color: 'var(--fg-2)' }}>
        {items.map((item) => (
          <li key={item} style={{ marginBottom: '4px' }}>{item}</li>
        ))}
      </ul>
    </Panel>
  );
}
