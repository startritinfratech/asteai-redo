'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { errorMessage, fetcher } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button, Empty, Field, KPI, PageHeader, Panel, Tag } from '@/components/ui';
import { RaiseDisputeForm } from '../disputes/RaiseDisputeForm';
import { PAYMENT_MESSAGES, payWithRazorpay, type PaymentOutcome } from '../payments';
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
        title={contract.title || contract.id}
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
        {toMinor(contract.refundDue) > 0 && (
          <p className={styles.pending}>
            Refund due: {formatMoney(contract.refundDue, contract.currency)}, held in escrow when the contract was cancelled, is owed back to the buyer.
          </p>
        )}
        {contract.status === 'disputed' && (
          <p className={styles.pending}>
            This contract is paused while a dispute is open: milestones cannot be funded, submitted or released.{' '}
            <Link href="/platform/disputes">View disputes</Link>
          </p>
        )}
        {contract.gigOrderId && (
          <p className={styles.muted}>
            Pre-packaged service order: <Link href={`/platform/orders/${encodeURIComponent(contract.gigOrderId)}`}>open the order</Link>
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

      {side === 'admin' && contract.status === 'cancelled' && toMinor(contract.refundDue) > 0 && (
        <RefundPanel contract={contract} onDone={refresh} />
      )}

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

const POLL_EVERY_MS = 3000;
const POLL_TIMES = 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type PayNotice = { tone: 'ok' | 'pending' | 'error'; text: string };

function MilestoneItem({
  contract, milestone: m, side, onDone,
}: { contract: Contract; milestone: ContractMilestone; side: Side; onDone: (c?: Contract) => void }) {
  const user = useAuthStore((s) => s.user);
  const [mode, setMode] = useState<MilestoneUiAction | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payNotice, setPayNotice] = useState<PayNotice | null>(null);
  const [disputing, setDisputing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const actions = milestoneUiActions(side, contract.status, m);
  const amount = formatMoney(m.amount, contract.currency);
  const canDispute = contract.status === 'active' && (side === 'buyer' || side === 'expert')
    && ['funded', 'submitted', 'revision_requested', 'accepted'].includes(m.status);

  /** After Razorpay took the money: re-fetch a few times until the milestone shows as funded. */
  async function waitForCapture(): Promise<boolean> {
    for (let i = 0; i < POLL_TIMES && mounted.current; i++) {
      await sleep(POLL_EVERY_MS);
      try {
        const next = await contractsApi.get(contract.id);
        onDone(next);
        if (next.milestones.find((x) => x.id === m.id)?.status !== 'pending') return true;
      } catch {
        // keep polling; the next attempt may succeed
      }
    }
    return false;
  }

  async function fund() {
    const checkout = await contractsApi.fund(contract.id, m.id);
    let outcome: PaymentOutcome;
    try {
      outcome = await payWithRazorpay(checkout, {
        name: 'AsteAI escrow',
        description: `${contract.id} · milestone ${m.seq}: ${m.title}`,
        prefill: { name: [user?.firstName, user?.lastName].filter(Boolean).join(' '), email: user?.email },
      });
    } catch (err) {
      setMode(null);
      onDone(); // the payment request is open; show it
      setPayNotice({ tone: 'error', text: errorMessage(err, PAYMENT_MESSAGES.loadFailed) });
      return;
    }
    setMode(null);
    if (outcome.kind === 'captured') {
      setPayNotice({ tone: 'ok', text: PAYMENT_MESSAGES.captured });
      onDone();
    } else if (outcome.kind === 'pending') {
      setPayNotice({ tone: 'pending', text: PAYMENT_MESSAGES.pending });
      const funded = await waitForCapture();
      if (!mounted.current) return;
      setPayNotice(funded
        ? { tone: 'ok', text: PAYMENT_MESSAGES.captured }
        : { tone: 'pending', text: `${PAYMENT_MESSAGES.pending} This can take a few minutes; you can leave this page.` });
    } else {
      onDone();
      setPayNotice({
        tone: outcome.kind === 'failed' ? 'error' : 'pending',
        text: outcome.kind === 'failed' ? PAYMENT_MESSAGES.failed(outcome.message) : PAYMENT_MESSAGES.dismissed,
      });
    }
  }

  async function confirm() {
    if (!mode) return;
    setBusy(true);
    setError(null);
    setPayNotice(null);
    try {
      const id = contract.id;
      if (mode === 'fund') {
        await fund();
        return;
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
  const label = (a: MilestoneUiAction) => (a === 'fund' && m.paymentPending ? 'Complete payment' : ACTION_LABEL[a]);
  const prompt: Record<MilestoneUiAction, string> = {
    fund: `Fund ${amount} into escrow for this milestone? You will pay through Razorpay; the milestone is funded once the payment is confirmed.`,
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
      {m.status === 'pending' && m.paymentPending && !payNotice && (
        <p className={styles.pending} role="status">
          {side === 'buyer'
            ? 'Payment started but not confirmed yet. If you already paid, this updates when the bank confirms; otherwise use Complete payment.'
            : 'Payment pending — awaiting confirmation from Razorpay'}
        </p>
      )}
      {payNotice && (
        <p
          className={payNotice.tone === 'ok' ? styles.ok : payNotice.tone === 'error' ? styles.error : styles.pending}
          role={payNotice.tone === 'error' ? 'alert' : 'status'}
        >
          {payNotice.text}
        </p>
      )}
      {m.submissionNote && <p className={styles.note}>Delivery note: {m.submissionNote}</p>}
      {m.status === 'revision_requested' && m.revisionNote && <p className={styles.note}>Revision requested: {m.revisionNote}</p>}

      {actions.length > 0 && !mode && !busy && (
        <div className={styles.actions}>
          {actions.map((a) => (
            <Button
              key={a}
              variant={a === 'request_revision' ? 'rose' : a === 'release' || a === 'accept' ? 'mint' : 'primary'}
              onClick={() => { setError(null); setPayNotice(null); setMode(a); }}
            >
              {label(a)}
            </Button>
          ))}
        </div>
      )}

      {canDispute && !mode && !disputing && (
        <div className={styles.actions}>
          <Button variant="rose" onClick={() => setDisputing(true)}>Raise a dispute</Button>
        </div>
      )}
      {disputing && (
        <RaiseDisputeForm
          contractId={contract.id}
          milestoneId={m.id}
          milestoneTitle={m.title}
          maxAmount={m.amount}
          currency={contract.currency}
          onCancel={() => setDisputing(false)}
        />
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
              {busy
                ? (mode === 'fund' ? 'Waiting for payment…' : 'Working…')
                : mode === 'fund' ? `Pay ${amount}` : mode === 'release' ? `Confirm: release ${amount}` : ACTION_LABEL[mode]}
            </Button>
          </div>
        </div>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </li>
  );
}

// ─── Refund (admin) ─────────────────────────────────────────────────────────

function RefundPanel({ contract, onDone }: { contract: Contract; onDone: (c?: Contract) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [amountText, setAmountText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const due = formatMoney(contract.refundDue, contract.currency);
  const amount = amountText.trim() ? Number(amountText) : undefined;
  const amountOk = amount === undefined
    || (Number.isFinite(amount) && amount > 0 && toMinor(amount) <= toMinor(contract.refundDue) && toMinor(amount) / 100 === amount);

  async function refund() {
    setBusy(true);
    setError(null);
    try {
      const out = await contractsApi.refund(contract.id, { reason: reason.trim(), amount });
      const total = out.refunds.filter((r) => r.status !== 'failed').reduce((acc, r) => acc + toMinor(r.amount), 0) / 100;
      const failed = out.refunds.filter((r) => r.status === 'failed');
      setDone(failed.length
        ? `Razorpay refused ${failed.length} refund${failed.length === 1 ? '' : 's'}: ${failed[0].error ?? 'unknown reason'}`
        : `Refund of ${formatMoney(total, contract.currency)} requested. It is settled when Razorpay confirms it (usually within minutes); the buyer is notified then.`);
      setOpen(false);
      setReason('');
      setAmountText('');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className={styles.stack}>
      <h2 className={styles.h2}>Refund</h2>
      <p className={styles.muted}>{due} is due back to the buyer. Refunds go to the original payment through Razorpay.</p>
      {!open ? (
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => { setDone(null); setOpen(true); }}>Issue refund…</Button>
        </div>
      ) : (
        <div className={styles.confirm}>
          <Field label="Reason">
            <textarea rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label={`Amount (leave empty to refund all ${due})`}>
            <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
          </Field>
          {!amountOk && <p className={styles.error}>Enter an amount up to {due}, with at most 2 decimals.</p>}
          <div className={styles.actions}>
            <Button onClick={() => setOpen(false)} disabled={busy}>Back</Button>
            <Button variant="primary" disabled={busy || reason.trim().length < 3 || !amountOk} onClick={() => void refund()}>
              {busy ? 'Refunding…' : `Confirm: refund ${amount !== undefined && amountOk ? formatMoney(amount, contract.currency) : due}`}
            </Button>
          </div>
        </div>
      )}
      {done && <p className={styles.ok} role="status">{done}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </Panel>
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
