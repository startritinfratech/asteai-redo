'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { DISPUTE_LIMITS } from '@asteai/types';
import { errorMessage, fetcher } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button, Empty, Field, KPI, PageHeader, Panel, Tag } from '@/components/ui';
import { formatMoney } from '../contracts/terms';
import { disputeKey, disputesApi } from './api';
import {
  isOpenStatus, parseEvidence, REASON_LABEL, RESOLUTION_LABEL, RESOLUTION_OPTIONS, slaLabel, splitError, STATUS_LABEL,
  statusColor,
} from './terms';
import type { Dispute, DisputeResolution } from './types';
import styles from './Disputes.module.css';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** /platform/disputes/[id]: facts, message thread with evidence, reply form, withdraw, admin resolution. */
export function DisputeDetail({ id }: { id: string }) {
  const user = useAuthStore((s) => s.user);
  const { data: dispute, error, isLoading, mutate } = useSWR<Dispute>(disputeKey(id), fetcher);
  if (isLoading) return <Empty message="Loading dispute…" />;
  if (error || !dispute) return <Empty message={errorMessage(error, 'Could not load this dispute.')} />;

  const isAdmin = user?.role === 'Admin';
  const isParty = [dispute.buyerId, dispute.expertId, dispute.raisedBy, dispute.againstUser].includes(user?.id ?? '');
  const open = isOpenStatus(dispute.status);
  const refresh = (next?: Dispute) => { void mutate(next, { revalidate: !next }); };
  const sla = slaLabel(dispute);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Dispute"
        title={dispute.projectTitle ?? dispute.contractId ?? dispute.id}
        sub={<span className={styles.mono}>{dispute.id}</span>}
        actions={<Link href="/platform/disputes">All disputes</Link>}
      />

      <Panel className={styles.stack}>
        <div className={styles.between}>
          <h2 className={styles.h2}>{dispute.raisedByName} vs {dispute.againstUserName}</h2>
          <Tag color={statusColor(dispute.status)}>{STATUS_LABEL[dispute.status]}</Tag>
        </div>
        <dl className={styles.facts}>
          <div><dt>Reason</dt><dd>{REASON_LABEL[dispute.reasonCode] ?? dispute.reasonCode}</dd></div>
          <div><dt>Milestone</dt><dd>{dispute.milestoneTitle ?? 'Whole contract'}</dd></div>
          <div><dt>Raised</dt><dd>{formatDateTime(dispute.createdAt)}</dd></div>
          <div><dt>Respond by</dt><dd>{formatDateTime(dispute.respondBy)}</dd></div>
          {dispute.contractId && (
            <div>
              <dt>Contract</dt>
              <dd><Link href={`/platform/contracts/${encodeURIComponent(dispute.contractId)}`}>{dispute.contractId}</Link></dd>
            </div>
          )}
        </dl>
        {sla && <p className={dispute.overdue ? styles.error : styles.warn}>{sla}</p>}
        <p className={styles.desc}>{dispute.description}</p>
        {dispute.source === 'legacy_project' && <p className={styles.muted}>Migrated from the original project-level disputes.</p>}
        {dispute.status === 'resolved' && (
          <p className={styles.ok}>
            Resolved: {RESOLUTION_LABEL[dispute.resolution ?? ''] ?? dispute.resolution ?? 'closed'}
            {dispute.resolution === 'split' && dispute.splitExpertAmount !== null && dispute.splitBuyerAmount !== null
              ? ` (expert ${formatMoney(dispute.splitExpertAmount, dispute.currency)}, buyer ${formatMoney(dispute.splitBuyerAmount, dispute.currency)})`
              : ''}
            {dispute.resolutionNote ? `. ${dispute.resolutionNote}` : ''}
          </p>
        )}
      </Panel>

      <section aria-label="Amounts" className={styles.grid2}>
        <KPI value={dispute.amountInDispute === null ? '—' : formatMoney(dispute.amountInDispute, dispute.currency)} label="Amount in dispute" />
        <KPI value={formatMoney(dispute.heldAmount, dispute.currency)} label="Held in escrow" />
      </section>

      <Panel className={styles.stack}>
        <h2 className={styles.h2}>Messages</h2>
        {!dispute.messages.length && <p className={styles.muted}>No messages yet.</p>}
        <ul className={styles.thread}>
          {dispute.messages.map((m) => (
            <li key={m.id} className={`${styles.msg} ${m.internal ? styles.msgInternal : ''}`}>
              <div className={styles.msgHead}>
                <strong>{m.authorName}</strong>
                <Tag color={m.authorSide === 'admin' ? 'gold' : 'default'}>{m.authorSide === 'admin' ? 'AsteAI team' : m.authorSide}</Tag>
                {m.internal && <Tag color="amber">Internal note</Tag>}
                <span>{formatDateTime(m.createdAt)}</span>
              </div>
              <p className={styles.msgBody}>{m.body}</p>
              {m.evidenceLinks.length > 0 && (
                <ul className={styles.links}>
                  {m.evidenceLinks.map((l) => (
                    <li key={l}><a href={l} target="_blank" rel="noopener noreferrer nofollow">{l}</a></li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        {open && (isParty || isAdmin) && <ReplyForm id={dispute.id} isAdmin={isAdmin} onDone={refresh} />}
      </Panel>

      {open && user?.id === dispute.raisedBy && !isAdmin && <WithdrawPanel id={dispute.id} onDone={refresh} />}
      {open && isAdmin && <ResolvePanel dispute={dispute} onDone={refresh} />}
    </div>
  );
}

function ReplyForm({ id, isAdmin, onDone }: { id: string; isAdmin: boolean; onDone: (d: Dispute) => void }) {
  const [body, setBody] = useState('');
  const [evidence, setEvidence] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseEvidence(evidence);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      onDone(await disputesApi.message(id, { body: body.trim(), evidenceLinks: parsed.links, internal: isAdmin ? internal : undefined }));
      setBody('');
      setEvidence('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.stack} onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <Field label="Your message">
        <textarea rows={4} maxLength={DISPUTE_LIMITS.message} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <Field label="Evidence links (https, one per line, up to 10)">
        <textarea rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
      </Field>
      {parsed.error && <p className={styles.error}>{parsed.error}</p>}
      {isAdmin && (
        <label className={styles.check}>
          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
          <span>Internal note: only admins can see it.</span>
        </label>
      )}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={busy || !body.trim() || Boolean(parsed.error)}>
          {busy ? 'Sending…' : internal ? 'Add internal note' : 'Send'}
        </Button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </form>
  );
}

function WithdrawPanel({ id, onDone }: { id: string; onDone: (d: Dispute) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      onDone(await disputesApi.withdraw(id));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Panel className={styles.stack}>
      <h2 className={styles.h2}>Withdraw</h2>
      {!confirming ? (
        <div className={styles.actions}><Button onClick={() => setConfirming(true)}>Withdraw dispute…</Button></div>
      ) : (
        <div className={styles.confirm}>
          <p className={styles.muted}>Withdrawing closes the dispute and lets the contract continue.</p>
          <div className={styles.actions}>
            <Button onClick={() => setConfirming(false)} disabled={busy}>Keep dispute</Button>
            <Button variant="rose" disabled={busy} onClick={() => void withdraw()}>{busy ? 'Withdrawing…' : 'Confirm withdrawal'}</Button>
          </div>
        </div>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </Panel>
  );
}

function ResolvePanel({ dispute, onDone }: { dispute: Dispute; onDone: (d: Dispute) => void }) {
  const [resolution, setResolution] = useState<DisputeResolution>('no_action');
  const [expertText, setExpertText] = useState('');
  const [buyerText, setBuyerText] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const held = dispute.heldAmount;
  const money = (n: number) => formatMoney(n, dispute.currency);
  const isSplit = resolution === 'split';
  const splitProblem = isSplit ? splitError(expertText, buyerText, held) : null;
  const moves = resolution !== 'no_action' && held <= 0;
  const valid = note.trim().length >= 3 && !splitProblem && !moves;
  const summary = {
    release_to_expert: `Release ${money(held)} to the expert.`,
    refund_to_buyer: `Cancel the milestone and refund ${money(held)} to the buyer through Razorpay.`,
    split: `Release ${money(Number(expertText) || 0)} to the expert and refund ${money(Number(buyerText) || 0)} to the buyer.`,
    no_action: 'Move no money.',
  }[resolution];

  async function resolve() {
    setBusy(true);
    setError(null);
    try {
      const out = await disputesApi.resolve(dispute.id, {
        resolution,
        note: note.trim(),
        ...(isSplit && { splitExpertAmount: Number(expertText), splitBuyerAmount: Number(buyerText) }),
      });
      setConfirming(false);
      setDone(out.refund.status === 'failed'
        ? `Resolved, but the refund of ${money(out.refund.amount)} could not be started (${out.refund.error ?? 'unknown error'}). Retry it from the contract page.`
        : out.refund.status === 'requested'
          ? `Resolved. A refund of ${money(out.refund.amount)} was requested; the buyer is notified when Razorpay confirms.`
          : 'Resolved.');
      onDone(out.dispute);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className={styles.stack}>
      <h2 className={styles.h2}>Resolve dispute</h2>
      <Field label="Resolution">
        <select value={resolution} onChange={(e) => { setResolution(e.target.value as DisputeResolution); setConfirming(false); }}>
          {RESOLUTION_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Field>
      {isSplit && (
        <>
          <div className={styles.grid2}>
            <Field label="To expert"><input inputMode="decimal" value={expertText} onChange={(e) => setExpertText(e.target.value)} /></Field>
            <Field label="Refund to buyer"><input inputMode="decimal" value={buyerText} onChange={(e) => setBuyerText(e.target.value)} /></Field>
          </div>
          <p className={styles.sum}>Held in escrow: {money(held)}</p>
          {splitProblem && <p className={styles.error}>{splitProblem}</p>}
        </>
      )}
      {moves && <p className={styles.error}>No escrow is held on the disputed milestone, so only “No action” is possible.</p>}
      <Field label="Resolution note (shown to both parties)">
        <textarea rows={3} maxLength={DISPUTE_LIMITS.message} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {!confirming ? (
        <div className={styles.actions}>
          <Button variant="primary" disabled={!valid} onClick={() => setConfirming(true)}>Review resolution…</Button>
        </div>
      ) : (
        <div className={styles.confirm}>
          <p className={styles.muted}>{summary} Both parties are notified. This cannot be undone.</p>
          <div className={styles.actions}>
            <Button onClick={() => setConfirming(false)} disabled={busy}>Back</Button>
            <Button variant="primary" disabled={busy} onClick={() => void resolve()}>{busy ? 'Resolving…' : 'Confirm resolution'}</Button>
          </div>
        </div>
      )}
      {done && <p className={styles.ok} role="status">{done}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </Panel>
  );
}
