'use client';

import { useState } from 'react';
import { Button, Empty, Field, Tag } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { billingApi } from './api';
import { formatDate, formatInr, parsePayoutAmount, PAYOUT_STATUS_LABEL, payoutStatusColor } from './format';
import type { PayoutAccount, PayoutOverview, PayoutRequest } from './types';
import styles from './Billing.module.css';

/** Request a payout (with a confirm step) and the expert's payout history. */
export function PayoutsPanel({
  overview, account, onChanged,
}: { overview: PayoutOverview | undefined; account: PayoutAccount | null; onChanged: () => void }) {
  const [amountText, setAmountText] = useState('');
  const [confirming, setConfirming] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const minimum = overview?.minimum ?? 500;
  const available = overview?.available ?? 0;
  const open = overview?.requests.find((r) => r.status === 'requested' || r.status === 'approved');

  function review() {
    setDone(null);
    const parsed = parsePayoutAmount(amountText, minimum, available);
    if (parsed.amount === null) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setConfirming(parsed.amount);
  }

  async function submit() {
    if (confirming === null) return;
    setBusy(true);
    setError(null);
    try {
      const req = await billingApi.requestPayout(confirming);
      setDone(`Payout of ${formatInr(req.amount)} requested.`);
      setConfirming(null);
      setAmountText('');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  let blocker: string | null = null;
  if (!account) blocker = 'Add a payout account first.';
  else if (open) blocker = `You have a payout of ${formatInr(open.amount)} in progress. You can request another once it is paid or rejected.`;
  else if (available < minimum) blocker = `You can request a payout once your available balance reaches ${formatInr(minimum)}.`;

  return (
    <div className={styles.stack}>
      <p className={styles.notice}>
        Payouts are made by bank transfer by the AsteAI team, not automatically. After your request is approved,
        an admin transfers the money and records the bank reference (UTR); you are notified by email.
      </p>

      {blocker ? (
        <p className={styles.muted}>{blocker}</p>
      ) : confirming === null ? (
        <form className={styles.row} onSubmit={(e) => { e.preventDefault(); review(); }}>
          <div className={styles.grow}>
            <Field label={`Amount (INR, ${formatInr(minimum)} to ${formatInr(available)})`}>
              <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder={String(minimum)} />
            </Field>
          </div>
          <div className={`${styles.actions} ${styles.alignEnd}`}>
            <Button onClick={() => setAmountText(String(available))}>Max</Button>
            <Button type="submit" variant="primary">Review payout</Button>
          </div>
        </form>
      ) : (
        <div className={styles.confirm}>
          <p className={styles.muted}>
            Request a payout of <strong>{formatInr(confirming)}</strong> to {account?.accountHolder}{' '}
            (<span className={styles.mono}>{account?.masked}</span>)? The amount is reserved from your available
            balance until the payout is paid, rejected or cancelled.
          </p>
          <div className={styles.actions}>
            <Button onClick={() => setConfirming(null)} disabled={busy}>Back</Button>
            <Button variant="mint" onClick={() => void submit()} disabled={busy}>
              {busy ? 'Requesting…' : `Confirm: request ${formatInr(confirming)}`}
            </Button>
          </div>
        </div>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {done && <p className={styles.ok} role="status">{done}</p>}

      <h3 className={styles.h2}>Payout history</h3>
      {!overview ? (
        <Empty message="Loading payouts…" />
      ) : overview.requests.length === 0 ? (
        <Empty message="No payout requests yet." />
      ) : (
        <ul className={styles.list}>
          {overview.requests.map((r) => <PayoutItem key={r.id} request={r} onChanged={onChanged} />)}
        </ul>
      )}
    </div>
  );
}

function PayoutItem({ request: r, onChanged }: { request: PayoutRequest; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await billingApi.cancelPayout(r.id);
      setConfirming(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={styles.item}>
      <div className={styles.itemMain}>
        <div className={styles.row}>
          <Tag color={payoutStatusColor(r.status)}>{PAYOUT_STATUS_LABEL[r.status]}</Tag>
          <span className={styles.muted}>Requested {formatDate(r.requestedAt)}</span>
        </div>
        <span className={styles.mono}>{r.accountMasked}</span>
        {r.status === 'paid' && r.reference && (
          <span className={styles.muted}>Paid {r.paidAt ? formatDate(r.paidAt) : ''} · reference <span className={styles.mono}>{r.reference}</span></span>
        )}
        {r.status === 'rejected' && r.adminNote && <span className={styles.muted}>Reason: {r.adminNote}</span>}
      </div>
      <span className={styles.amount}>{formatInr(r.amount, r.currency)}</span>
      {r.status === 'requested' && (
        <div className={styles.itemFull}>
          {confirming ? (
            <div className={styles.confirm}>
              <p className={styles.muted}>Cancel this payout request? The amount becomes available again.</p>
              <div className={styles.actions}>
                <Button onClick={() => setConfirming(false)} disabled={busy}>Keep it</Button>
                <Button variant="rose" onClick={() => void cancel()} disabled={busy}>{busy ? 'Cancelling…' : 'Confirm: cancel request'}</Button>
              </div>
            </div>
          ) : (
            <div className={styles.actions}>
              <Button variant="sm" onClick={() => setConfirming(true)}>Cancel request</Button>
            </div>
          )}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
      )}
    </li>
  );
}
