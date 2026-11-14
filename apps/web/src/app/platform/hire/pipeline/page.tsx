'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { allowedNextStages, type ApplicationStage, type ApplicationSummary, type Requisition } from '@asteai/types';
import { errorMessage, fetcher } from '@/lib/api';
import { fetchAllRequisitions } from '@/lib/requisitions';
import { useAuthStore } from '@/store/auth';
import { Button, Dialog, Empty, PageHeader, Tag } from '@/components/ui';
import { HIRE_KEYS, hireApi } from '@/features/hire/api';
import { canDrop, groupByColumn, PIPELINE_COLUMNS } from '@/features/hire/format';
import styles from '@/features/hire/Hire.module.css';

const DAY = 86_400_000;

/** Applications pipeline as a Kanban board: drag a card, or use its stage selector. */
export default function PipelinePage() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'Admin');
  const { data: reqs } = useSWR<Requisition[]>('/requisitions?all', fetchAllRequisitions);
  const [reqId, setReqId] = useState('');
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('req');
    if (fromUrl) setReqId(fromUrl);
  }, []);
  const active = reqId || reqs?.[0]?.id || '';
  const { data: apps, error, mutate } = useSWR<ApplicationSummary[]>(active ? HIRE_KEYS.applications(active) : null, fetcher);

  const [dragging, setDragging] = useState<ApplicationSummary | null>(null);
  const [over, setOver] = useState<ApplicationStage | null>(null);
  const [rejecting, setRejecting] = useState<ApplicationSummary | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function move(app: ApplicationSummary, stage: ApplicationStage, why?: string) {
    if (stage === 'Rejected' && !why) {
      setRejecting(app);
      setReason('');
      return;
    }
    setBusy(app.id);
    setMessage(null);
    // Optimistic: show the card in its new lane at once; the API's answer replaces it.
    void mutate((list) => list?.map((a) => (a.id === app.id ? { ...a, stage } : a)), { revalidate: false });
    try {
      await hireApi.moveApplication(app.id, { stage, expectedStage: app.stage, reason: why });
      setMessage({ ok: true, text: `${app.candidateName ?? 'Candidate'} → ${stage}` });
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err, 'Could not move the application') });
    } finally {
      setBusy(null);
      void mutate();
    }
  }

  const lanes = groupByColumn(apps ?? []);

  return (
    <>
      <PageHeader eyebrow="Hire & ATS" title="Applications pipeline" sub="Applied → Screened → Interview → Shortlist → Offer. Drag cards between stages or use each card's stage menu." />
      <div className={styles.row}>
        <label htmlFor="pl-req" className={styles.label}>Requisition</label>
        <select id="pl-req" className={styles.select} style={{ maxWidth: 420 }} value={active} onChange={(e) => setReqId(e.target.value)}>
          {(reqs ?? []).map((r) => <option key={r.id} value={r.id}>{r.title} ({r.id})</option>)}
        </select>
      </div>
      {message && <p className={message.ok ? styles.ok : styles.error} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}

      {!reqs ? <Empty message="Loading…" /> : !reqs.length ? <Empty message="No requisitions yet." /> : error ? <Empty message="Could not load applications." /> : !apps ? <Empty message="Loading…" /> : (
        <div className={styles.board}>
          {PIPELINE_COLUMNS.map((col) => {
            const cards = lanes.get(col.stage) ?? [];
            const allowed = dragging ? canDrop(dragging.stage, col.stage, isAdmin) : true;
            return (
              <section
                key={col.stage}
                aria-label={`${col.label}, ${cards.length}`}
                className={[styles.lane, dragging && over === col.stage && allowed ? styles.laneDrop : '', dragging && !allowed && col.stage !== dragging.stage ? styles.laneBlocked : ''].join(' ')}
                onDragOver={(e) => { if (dragging && allowed) { e.preventDefault(); setOver(col.stage); } }}
                onDragLeave={() => setOver((o) => (o === col.stage ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  if (dragging && allowed) void move(dragging, col.stage);
                  setDragging(null);
                }}
              >
                <div className={styles.laneHead}><h2 className={styles.h3}>{col.label}</h2><span className={styles.muted}>{cards.length}</span></div>
                {cards.map((a) => {
                  const next = allowedNextStages(a.stage, isAdmin);
                  return (
                    <article
                      key={a.id}
                      className={dragging?.id === a.id ? `${styles.card} ${styles.cardDragging}` : styles.card}
                      draggable={next.length > 0 && busy !== a.id}
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', a.id); setDragging(a); }}
                      onDragEnd={() => { setDragging(null); setOver(null); }}
                    >
                      <span className={styles.cardTitle}>{a.candidateName || 'Candidate'}</span>
                      {a.candidateEmail && <span className={styles.muted}>{a.candidateEmail}</span>}
                      <span className={styles.row}>
                        {a.stage !== col.stage && <Tag color="amber">{a.stage}</Tag>}
                        <span className={styles.muted}>{Math.max(0, Math.floor((Date.now() - a.t) / DAY))} d · {a.scorecards?.length ?? 0} scorecards</span>
                      </span>
                      {next.length > 0 && (
                        <select
                          className={styles.miniSelect}
                          aria-label={`Move ${a.candidateName ?? 'candidate'}`}
                          value=""
                          disabled={busy === a.id}
                          onChange={(e) => { if (e.target.value) void move(a, e.target.value as ApplicationStage); }}
                        >
                          <option value="">Move to…</option>
                          {next.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      )}
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}

      <Dialog
        open={rejecting !== null}
        onOpenChange={(o) => { if (!o) setRejecting(null); }}
        title={`Reject ${rejecting?.candidateName ?? 'candidate'}?`}
        size="sm"
        description="The reason is kept in the application's history."
        footer={(
          <>
            <Button onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="rose" disabled={reason.trim().length < 3} onClick={() => { const a = rejecting; setRejecting(null); if (a) void move(a, 'Rejected', reason.trim()); }}>Reject</Button>
          </>
        )}
      >
        <textarea className={styles.textarea} aria-label="Reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </Dialog>
    </>
  );
}
