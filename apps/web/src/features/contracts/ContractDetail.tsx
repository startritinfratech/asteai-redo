'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { errorMessage, fetcher } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button, Empty, Field, KPI, PageHeader, Panel, Tag } from '@/components/ui';
import { contractKey, contractsApi } from './api';
import {
  canCancel, describeTerms, formatMoney, milestoneUiActions, type MilestoneUiAction, type Side, sideOf, STATUS_LABEL,
  statusColor, toMinor,
} from './terms';
import type { Contract, ContractMilestone } from './types';
import styles from './Contracts.module.css';

const MODEL_LABEL: Record<string, string> = { fixed: 'Fixed price', hourly: 'Hourly', daily: 'Daily', sprint: 'Sprint' };

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** /platform/contracts/[id]: header, escrow summary, NDA + signing, milestone timeline, cancel. */
export function ContractDetail({ id }: { id: string }) {
  const user = useAuthStore((s) => s.user);
  const { data: contract, error, isLoading, mutate } = useSWR<Contract>(contractKey(id), fetcher);

  if (isLoading) return <Empty message="Loading contract…" />;
  if (error || !contract) return <Empty message={errorMessage(error, 'Could not load this contract.')} />;

  const side = sideOf(contract, user);
  const refresh = (next?: Contract) => { void mutate(next, { revalidate: !next }); };
  const funded = contract.escrowFunded;
  const released = contract.released;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Contract"
        title={contract.projectTitle || contract.id}
        sub={<span className={styles.mono}>{contract.id}</span>}
        actions={<Link href="/platform/contracts">All contracts</Link>}
      />

      <Panel className={styles.stack}>
        <div className={styles.between}>
          <h2 className={styles.title}>{contract.buyerName} ↔ {contract.expertName}</h2>
          <Tag color={statusColor(contract.status)}>{STATUS_LABEL[contract.status] ?? contract.status}</Tag>
        </div>
        <dl className={styles.facts}>
          <div><dt>Buyer</dt><dd>{contract.buyerName}</dd></div>
          <div><dt>Expert</dt><dd>{contract.expertName}</dd></div>
          <div><dt>Model</dt><dd>{MODEL_LABEL[contract.engagementModel] ?? contract.engagementModel}</dd></div>
          <div><dt>Total</dt><dd className={styles.mono}>{formatMoney(contract.totalAmount, contract.currency)}</dd></div>
          <div>
            <dt>Terms</dt>
            <dd>{describeTerms(contract.engagementModel, contract.paymentTerms as unknown as Record<string, number>, contract.currency)}</dd>
          </div>
        </dl>
        {contract.status === 'cancelled' && contract.cancelReason && (
          <p className={styles.note}>Cancelled: {contract.cancelReason}</p>
        )}
        {contract.status === 'cancelled' && toMinor(contract.escrowFunded) > toMinor(contract.released) && (
          <p className={styles.pending}>
            {formatMoney(contract.escrowFunded - contract.released, contract.currency)} held in escrow is due back to the buyer (refund pending).
          </p>
        )}
        {contract.source === 'legacy_project' && (
          <p className={styles.muted}>Migrated from the project&apos;s original milestones.</p>
        )}
      </Panel>

      <section className={styles.kpis} aria-label="Escrow summary">
        <KPI value={formatMoney(funded, contract.currency)} label="Funded into escrow" />
        <KPI value={formatMoney(released, contract.currency)} label="Released to expert" />
        <KPI value={formatMoney((toMinor(funded) - toMinor(released)) / 100, contract.currency)} label="Held in escrow" />
        <KPI value={formatMoney((toMinor(contract.totalAmount) - toMinor(funded)) / 100, contract.currency)} label="Not yet funded" />
      </section>

      <SignaturePanel contract={contract} side={side} onDone={refresh} />

      <Panel className={styles.stack}>
        <h2 className={styles.h2}>Milestones</h2>
        <ol className={styles.timeline}>
          {contract.milestones.map((m) => (
            <MilestoneItem key={m.id} contract={contract} milestone={m} side={side} onDone={refresh} />
          ))}
        </ol>
      </Panel>

      {canCancel(side, contract) && <CancelPanel contract={contract} side={side} onDone={refresh} />}
    </div>
  );
}

// ─── Signatures ─────────────────────────────────────────────────────────────

function SignaturePanel({ contract, side, onDone }: { contract: Contract; side: Side; onDone: (c?: Contract) => void }) {
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = contract.status === 'pending_signature';
  if (!contract.ndaRequired && !pending && !contract.buyerSignedAt && !contract.expertSignedAt) return null;

  const mySignedAt = side === 'buyer' ? contract.buyerSignedAt : side === 'expert' ? contract.expertSignedAt : null;
  const canSign = pending && (side === 'buyer' || side === 'expert') && !mySignedAt;

  async function run(fn: () => Promise<Contract>) {
    setBusy(true);
    setError(null);
    try {
      onDone(await fn());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className={styles.stack}>
      <h2 className={styles.h2}>{contract.ndaRequired ? 'NDA and signatures' : 'Signatures'}</h2>
      {contract.ndaRequired && contract.ndaText && <div className={styles.nda} tabIndex={0}>{contract.ndaText}</div>}

      <div className={styles.signatures}>
        {([['Buyer', contract.buyerName, contract.buyerSignature, contract.buyerSignedAt],
          ['Expert', contract.expertName, contract.expertSignature, contract.expertSignedAt]] as const).map(([role, who, sig, at]) => (
          <div key={role} className={styles.sigCard}>
            <div className={styles.muted}>{role}: {who}</div>
            {at
              ? <><div className={styles.sigName}>{sig}</div><div className={styles.muted}>Signed {formatDate(at)}</div></>
              : <div className={styles.muted}>Not signed yet</div>}
          </div>
        ))}
      </div>

      {canSign && (
        <form
          className={styles.stack}
          onSubmit={(e) => { e.preventDefault(); void run(() => contractsApi.sign(contract.id, name.trim())); }}
        >
          {contract.ndaRequired && (
            <label className={styles.check}>
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>I have read and agree to the NDA above.</span>
            </label>
          )}
          <Field label="Type your full name to sign">
            <input value={name} maxLength={200} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className={styles.actions}>
            {side === 'expert' && !declining && (
              <Button variant="rose" onClick={() => setDeclining(true)} disabled={busy}>Decline</Button>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={busy || name.trim().length < 2 || (contract.ndaRequired && !agreed)}
            >
              {busy ? 'Signing…' : 'Sign contract'}
            </Button>
          </div>
        </form>
      )}

      {declining && (
        <div className={styles.confirm}>
          <Field label="Reason (optional)">
            <textarea rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <p className={styles.muted}>Declining cancels this contract. The buyer is notified.</p>
          <div className={styles.actions}>
            <Button onClick={() => setDeclining(false)} disabled={busy}>Keep</Button>
            <Button variant="rose" disabled={busy} onClick={() => void run(() => contractsApi.decline(contract.id, reason.trim() || undefined))}>
              Decline contract
            </Button>
          </div>
        </div>
      )}
      {pending && mySignedAt && <p className={styles.muted}>You have signed. Waiting for the other party.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </Panel>
  );
}

// ─── Milestones ─────────────────────────────────────────────────────────────

const ACTION_LABEL: Record<MilestoneUiAction, string> = {
  fund: 'Fund',
  submit: 'Submit work',
  request_revision: 'Request revision',
  accept: 'Accept',
  release: 'Release payment',
};

function MilestoneItem({
  contract, milestone: m, side, onDone,
}: { contract: Contract; milestone: ContractMilestone; side: Side; onDone: (c?: Contract) => void }) {
  const [mode, setMode] = useState<MilestoneUiAction | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actions = milestoneUiActions(side, contract.status, m);
  const amount = formatMoney(m.amount, contract.currency);

  async function confirm() {
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      const id = contract.id;
      if (mode === 'fund') {
        await contractsApi.fund(id, m.id);
        onDone(); // re-fetch: the milestone now shows its pending payment
      } else {
        const next = await {
          submit: () => contractsApi.submit(id, m.id, note.trim()),
          request_revision: () => contractsApi.requestRevision(id, m.id, note.trim()),
          accept: () => contractsApi.accept(id, m.id),
          release: () => contractsApi.release(id, m.id),
        }[mode]();
        onDone(next);
      }
      setMode(null);
      setNote('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const needsNote = mode === 'submit' || mode === 'request_revision';
  const prompt: Record<MilestoneUiAction, string> = {
    fund: `Fund ${amount} into escrow for this milestone? You will be asked to pay through the payment provider; the milestone is funded once the payment is confirmed.`,
    submit: 'Describe what you are delivering.',
    request_revision: 'Tell the expert what needs to change.',
    accept: `Accept this delivery? You can then release ${amount} to the expert.`,
    release: `Release ${amount} from escrow to ${contract.expertName}? This cannot be undone.`,
  };

  return (
    <li className={styles.ms} data-status={m.status}>
      <div className={styles.row}>
        <span className={styles.muted}>#{m.seq}</span>
        <span className={styles.msTitle}>{m.title}</span>
        <span className={styles.msAmt}>{amount}</span>
      </div>
      <div className={styles.row}>
        <Tag color={statusColor(m.status)}>{STATUS_LABEL[m.status] ?? m.status}</Tag>
        {m.dueDate && <span className={styles.muted}>Due {formatDate(m.dueDate)}</span>}
        {m.revisionCount > 0 && <span className={styles.muted}>{m.revisionCount} revision{m.revisionCount === 1 ? '' : 's'}</span>}
        {m.releasedAt && <span className={styles.muted}>Released {formatDate(m.releasedAt)}</span>}
      </div>
      {m.status === 'pending' && m.paymentPending && (
        <p className={styles.pending} role="status">Payment pending — awaiting payment provider</p>
      )}
      {m.submissionNote && <p className={styles.note}>Delivery note: {m.submissionNote}</p>}
      {m.status === 'revision_requested' && m.revisionNote && <p className={styles.note}>Revision requested: {m.revisionNote}</p>}

      {actions.length > 0 && !mode && (
        <div className={styles.actions}>
          {actions.map((a) => (
            <Button
              key={a}
              variant={a === 'request_revision' ? 'rose' : a === 'release' || a === 'accept' ? 'mint' : 'primary'}
              onClick={() => { setError(null); setMode(a); }}
            >
              {ACTION_LABEL[a]}
            </Button>
          ))}
        </div>
      )}

      {mode && (
        <div className={styles.confirm}>
          <p className={styles.muted}>{prompt[mode]}</p>
          {needsNote && (
            <Field label={mode === 'submit' ? 'Delivery note' : 'What should change'}>
              <textarea rows={4} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          )}
          <div className={styles.actions}>
            <Button onClick={() => { setMode(null); setError(null); }} disabled={busy}>Back</Button>
            <Button
              variant={mode === 'request_revision' ? 'rose' : 'primary'}
              disabled={busy || (needsNote && !note.trim())}
              onClick={() => void confirm()}
            >
              {busy ? 'Working…' : mode === 'fund' ? `Confirm: fund ${amount}` : mode === 'release' ? `Confirm: release ${amount}` : ACTION_LABEL[mode]}
            </Button>
          </div>
        </div>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </li>
  );
}

// ─── Cancel ─────────────────────────────────────────────────────────────────

function CancelPanel({ contract, side, onDone }: { contract: Contract; side: Side; onDone: (c?: Contract) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      onDone(await contractsApi.cancel(contract.id, reason.trim()));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className={styles.stack}>
      <h2 className={styles.h2}>Cancel contract</h2>
      {!open ? (
        <div className={styles.actions}>
          <Button variant="rose" onClick={() => setOpen(true)}>Cancel contract…</Button>
        </div>
      ) : (
        <div className={styles.confirm}>
          <Field label="Reason">
            <textarea rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <p className={styles.muted}>
            {side === 'admin' && toMinor(contract.escrowFunded - contract.released) > 0
              ? `${formatMoney(contract.escrowFunded - contract.released, contract.currency)} is held in escrow and will need a refund.`
              : 'Open milestones are cancelled and any payment request in progress is voided.'}
            {' '}This cannot be undone.
          </p>
          <div className={styles.actions}>
            <Button onClick={() => setOpen(false)} disabled={busy}>Keep contract</Button>
            <Button variant="rose" disabled={busy || reason.trim().length < 3} onClick={() => void cancel()}>
              {busy ? 'Cancelling…' : 'Confirm cancellation'}
            </Button>
          </div>
        </div>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </Panel>
  );
}
