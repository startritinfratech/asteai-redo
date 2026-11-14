'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import type { HiringKpis, Requisition } from '@asteai/types';
import { errorMessage, fetcher } from '@/lib/api';
import { fetchAllRequisitions } from '@/lib/requisitions';
import { useAuthStore } from '@/store/auth';
import { Button, Empty, KPI, PageHeader, Panel, Tag } from '@/components/ui';
import { HIRE_KEYS, hireApi } from '@/features/hire/api';
import { APPROVAL_TAG, fmtDays, fmtPct, listingState } from '@/features/hire/format';
import styles from '@/features/hire/Hire.module.css';

const REQS_KEY = '/requisitions?all';

/** ATS Overview: live hiring KPIs and the requisitions manager (draft → open → public → approved). */
export default function HireOverviewPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'Admin');
  const { data: kpis, error: kpiError } = useSWR<HiringKpis | null>(HIRE_KEYS.kpis, fetcher, { refreshInterval: 60_000 });
  const { data: reqs, error: reqError, mutate } = useSWR<Requisition[]>(REQS_KEY, fetchAllRequisitions);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function act(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: ok });
      void mutate();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err, 'That did not work') });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Hire & ATS"
        title="Hiring overview"
        sub="Live pipeline KPIs and every requisition, from draft to approved public listing."
        actions={<Link href="/platform/hire/job-creator" className={styles.link}>+ New job with AI</Link>}
      />

      {kpiError ? <p className={styles.error}>Could not load the KPIs.</p> : (
        <div className={styles.kpis}>
          <KPI value={kpis?.openRequisitions ?? '—'} label="Open requisitions" />
          <KPI value={kpis?.activeCampaigns ?? '—'} label="Active outreach campaigns" />
          <KPI value={kpis ? fmtDays(kpis.timeToHireDays) : '—'} label={`Time to hire (median, ${kpis?.hiresLast180Days ?? 0} hires / 180 d)`} />
          <KPI value={kpis ? fmtPct(kpis.matchRatePct) : '—'} label={`Match rate (${kpis?.reviewedLast90Days ?? 0} reviewed / 90 d)`} />
          <KPI value={kpis?.pendingApproval ?? '—'} label="Awaiting approval" />
        </div>
      )}
      <p className={styles.muted}>
        Match rate: share of reviewed applications that passed screening. Time to hire: application to joining date.
      </p>

      <Panel className={styles.stack}>
        <div className={styles.between}>
          <h2 className={styles.h2}>Requisitions</h2>
          {isAdmin && <Link href="/platform/hire/approvals" className={styles.link}>Approval queue →</Link>}
        </div>
        {message && <p className={message.ok ? styles.ok : styles.error} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
        {reqError ? <Empty message="Could not load requisitions." /> : !reqs ? <Empty message="Loading…" /> : !reqs.length ? (
          <Empty message="No requisitions yet. Create one with the AI Job Creator." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Job</th><th>Status</th><th>Approval</th><th>Job board</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {reqs.map((r) => {
                  const approval = r.approval?.status ?? 'draft';
                  const listing = listingState(r);
                  return (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.title}</strong>
                        <div className={styles.muted}>{r.id} · {r.func} · {r.location || 'Remote/any'}</div>
                        {approval === 'rejected' && r.approval?.note && <div className={styles.error}>Reviewer: {r.approval.note}</div>}
                      </td>
                      <td><Tag color={r.status === 'Open' ? 'mint' : r.status === 'Draft' ? 'grey' : 'default'}>{r.status}</Tag></td>
                      <td><Tag color={APPROVAL_TAG[approval].color}>{APPROVAL_TAG[approval].label}</Tag></td>
                      <td><Tag color={listing.color}>{listing.label}</Tag></td>
                      <td>
                        <span className={styles.row} style={{ justifyContent: 'flex-end' }}>
                          {r.status === 'Draft' && (
                            <Button variantSize="sm" disabled={busy === r.id} onClick={() => { void act(r.id, () => hireApi.updateRequisition(r.id, { status: 'Open' }), `${r.title} is open.`); }}>Open</Button>
                          )}
                          {!r.posting?.isPublic ? (
                            <Button variantSize="sm" variant="primary" disabled={busy === r.id}
                              onClick={() => { void act(r.id, () => hireApi.setPosting(r.id, { isPublic: true }), approval === 'approved' ? 'Published to the job board.' : 'Submitted for approval; it goes live once approved.'); }}>
                              Publish
                            </Button>
                          ) : (
                            <Button variantSize="sm" disabled={busy === r.id} onClick={() => { void act(r.id, () => hireApi.setPosting(r.id, { isPublic: false }), 'Removed from the job board.'); }}>Unpublish</Button>
                          )}
                          {(approval === 'draft' || approval === 'rejected') && r.posting?.isPublic && (
                            <Button variantSize="sm" disabled={busy === r.id} onClick={() => { void act(r.id, () => hireApi.submitForApproval(r.id), 'Submitted for approval.'); }}>Resubmit</Button>
                          )}
                          <Link href={`/platform/hire/pipeline?req=${encodeURIComponent(r.id)}`} className={styles.link}>Pipeline</Link>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
