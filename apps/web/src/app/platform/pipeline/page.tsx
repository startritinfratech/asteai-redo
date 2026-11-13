'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { ApplicationSummary, ApplicationStage } from '@asteai/types';
import { api, errorMessage, fetcher } from '@/lib/api';
import { fetchAllRequisitions } from '@/lib/requisitions';
import { Empty, Field, PageHeader, Panel, Tag } from '@/components/ui';

const STAGES: ApplicationStage[] = [
  'Applied',
  'Assessment Pending',
  'Assessment Review',
  'Shortlisted',
  'Interview',
  'Offer',
  'Joined',
  'Rejected',
];

export default function PipelinePage() {
  // All requisitions, not just the API's first page of 20.
  const { data: reqs } = useSWR('/requisitions?all', fetchAllRequisitions);
  const [selectedReq, setSelectedReq] = useState<string>('');

  const activeReqId = selectedReq || (reqs && reqs.length > 0 ? reqs[0].id : '');

  const { data: apps, error, isLoading, mutate } = useSWR<ApplicationSummary[]>(
    activeReqId ? `/applications/requisition/${encodeURIComponent(activeReqId)}` : null,
    fetcher,
  );

  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function handleStageChange(appId: string, nextStage: ApplicationStage) {
    setUpdatingId(appId);
    try {
      await api.patch(`/applications/${encodeURIComponent(appId)}/stage`, { stage: nextStage });
      void mutate();
    } catch (err) {
      alert(errorMessage(err, 'Failed to update application stage'));
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Hire & ATS"
        title="Applications Pipeline"
        sub="Track candidate applications across recruitment stages, review psychometric fit, and advance applicants through your hiring funnel."
        actions={
          reqs && reqs.length > 0 ? (
            <select
              aria-label="Requisition"
              value={activeReqId}
              onChange={(e) => setSelectedReq(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg-1)', color: 'var(--fg-1)' }}
            >
              {reqs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} ({r.id})
                </option>
              ))}
            </select>
          ) : undefined
        }
      />

      {isLoading && <Empty message="Loading pipeline candidates…" />}
      {error && <Empty message="Could not load applications for this requisition." />}

      {apps && apps.length === 0 && (
        <Empty message="No candidate applications submitted for this requisition yet." />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
        {apps?.map((app) => (
          <Panel key={app.id} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{app.candidateName || app.candidateEmail || app.candidateId}</span>
              <Tag color={app.stage === 'Joined' ? 'mint' : app.stage === 'Rejected' ? 'rose' : 'amber'}>
                {app.stage}
              </Tag>
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              App ID: {app.id} · Applied: {app.t ? new Date(app.t).toLocaleDateString() : 'Recent'}
            </div>

            <div style={{ display: 'flex', gap: '12px', fontSize: '0.85rem', color: 'var(--fg-2)', background: 'var(--bg-2)', padding: '8px', borderRadius: '4px' }}>
              <div>Result: <b>{app.resultId ? 'Assessment Scored' : 'Pending Evaluation'}</b></div>
              <div>Notes: <b>{app.notes?.length || 0}</b></div>
              <div>Scorecards: <b>{app.scorecards?.length || 0}</b></div>
            </div>

            <div style={{ marginTop: '6px' }}>
              <Field label="Advance Candidate Stage">
                <select
                  disabled={updatingId === app.id}
                  value={app.stage}
                  onChange={(e) => handleStageChange(app.id, e.target.value as ApplicationStage)}
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
