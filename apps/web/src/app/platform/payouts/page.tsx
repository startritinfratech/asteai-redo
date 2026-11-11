'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useAuthStore } from '@/store/auth';
import { errorMessage, fetcher } from '@/lib/api';
import { Button, Chips, Empty, Field, PageHeader, Panel, Tag } from '@/components/ui';
import {
  adminPayoutsKey, billingApi, formatDate, formatInr, PAYOUT_STATUS_LABEL, payoutStatusColor,
  type PayoutDestination, type PayoutRequest, type PayoutStatus,
} from '@/features/billing';
import styles from '@/features/billing/Billing.module.css';

type Filter = PayoutStatus;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'requested', label: 'To approve' },
  { id: 'approved', label: 'To pay' },
  { id: 'paid', label: PAYOUT_STATUS_LABEL.paid },
  { id: 'rejected', label: PAYOUT_STATUS_LABEL.rejected },
  { id: 'cancelled', label: PAYOUT_STATUS_LABEL.cancelled },
];

/**
 * Admin payout queue. Bank transfers are made by hand outside AsteAI (RazorpayX payouts
 * are not connected): approve a request, transfer the money from the company account,
 * then record the bank reference (UTR) with "Mark paid", which debits the expert's wallet.
 */
export default function AdminPayoutsPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'Admin');
  const [filter, setFilter] = useState<Filter>('requested');
  const key = isAdmin ? adminPayoutsKey(filter) : null;
  const { data: requests, error, isLoading, mutate } = useSWR<PayoutRequest[]>(key, fetcher);

  if (!isAdmin) {
    return (
      <div className={styles.page}>
        <PageHeader eyebrow="Admin" title="Payouts" />
        <Empty message="Only admins can see the payout queue." />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Admin"
        title="Expert payouts"
        sub="Approve payout requests, pay them by bank transfer, and record the bank reference."
      />
      <p className={styles.notice}>
        Payouts are not sent automatically. After approving, transfer the amount by NEFT/IMPS/UPI from the company
        account to the details shown, then mark the payout paid with the bank reference (UTR). Marking paid debits
        the expert&apos;s wallet once and emails them.
      </p>

      <Chips options={FILTERS} value={filter} onChange={setFilter} label="Filter by status" />

      <Panel className={styles.stack}>
        {isLoading && <Empty message="Loading payouts…" />}
        {error && <Empty message="Could not load payouts." />}
        {requests && requests.length === 0 && <Empty message="Nothing here." />}
        {requests && requests.length > 0 && (
          <ul className={styles.list}>
            {requests.map((r) => <AdminPayoutItem key={r.id} request={r} onChanged={() => void mutate()} />)}
          </ul>
        )}
      </Panel>
    </div>
  );
}

type Mode = 'approve' | 'pay' | 'reject';

function AdminPayoutItem({ request: r, onChanged }: { request: PayoutRequest; onChanged: () => void }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dest, setDest] = useState<PayoutDestination | null>(null);
  const amount = formatInr(r.amount, r.currency);

  async function reveal() {
    setError(null);
    try {
      setDest(await billingApi.details(r.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function confirm() {
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'approve') await billingApi.approve(r.id);
      else if (mode === 'pay') await billingApi.markPaid(r.id, text.trim());
      else await billingApi.reject(r.id, text.trim());
      setMode(null);
      setText('');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const prompt: Record<Mode, string> = {
    approve: `Approve this payout of ${amount}? You then transfer the money and mark it paid.`,
    pay: `Record that ${amount} was transferred to ${r.accountHolder}? This debits the expert's wallet and cannot be undone.`,
    reject: `Reject this payout of ${amount}? The amount becomes available to the expert again.`,
  };
  const needsText = mode === 'pay' ? text.trim().length >= 6 : mode === 'reject' ? text.trim().length >= 3 : true;

  return (
    <li className={styles.item}>
      <div className={styles.itemMain}>
        <span className={styles.itemTitle}>{r.userName || r.userEmail || r.userId}</span>
        {r.userEmail && <span className={styles.muted}>{r.userEmail}</span>}
        <div className={styles.row}>
          <Tag color={payoutStatusColor(r.status)}>{PAYOUT_STATUS_LABEL[r.status]}</Tag>
          <span className={styles.muted}>Requested {formatDate(r.requestedAt)}</span>
          <span className={styles.mono}>{r.accountMasked}</span>
        </div>
        {r.reference && <span className={styles.muted}>Reference <span className={styles.mono}>{r.reference}</span></span>}
        {r.adminNote && <span className={styles.muted}>Note: {r.adminNote}</span>}
      </div>
      <span className={styles.amount}>{amount}</span>

      <div className={styles.itemFull}>
        {dest && (
          <dl className={styles.dest}>
            <dt>Account holder</dt><dd>{dest.accountHolder}</dd>
            {dest.method === 'bank' ? (
              <>
                <dt>Account number</dt><dd>{dest.accountNumber}</dd>
                <dt>IFSC</dt><dd>{dest.ifsc}</dd>
              </>
            ) : (
              <><dt>UPI id</dt><dd>{dest.upiId}</dd></>
            )}
          </dl>
        )}

        {mode ? (
          <div className={styles.confirm}>
            <p className={styles.muted}>{prompt[mode]}</p>
            {mode === 'pay' && (
              <Field label="Bank reference (UTR)">
                <input value={text} maxLength={64} onChange={(e) => setText(e.target.value)} />
              </Field>
            )}
            {mode === 'reject' && (
              <Field label="Reason (sent to the expert)">
                <textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
            )}
            <div className={styles.actions}>
              <Button onClick={() => { setMode(null); setText(''); setError(null); }} disabled={busy}>Back</Button>
              <Button
                variant={mode === 'reject' ? 'rose' : mode === 'pay' ? 'mint' : 'primary'}
                disabled={busy || !needsText}
                onClick={() => void confirm()}
              >
                {busy ? 'Working…' : mode === 'approve' ? 'Confirm: approve' : mode === 'pay' ? `Confirm: paid ${amount}` : 'Confirm: reject'}
              </Button>
            </div>
          </div>
        ) : (r.status === 'requested' || r.status === 'approved') && (
          <div className={styles.actions}>
            {r.status === 'approved' && !dest && <Button variant="sm" onClick={() => void reveal()}>Show bank details</Button>}
            {r.status === 'requested' && <Button variant="primary" onClick={() => setMode('approve')}>Approve</Button>}
            {r.status === 'approved' && <Button variant="mint" onClick={() => setMode('pay')}>Mark paid</Button>}
            <Button variant="rose" onClick={() => setMode('reject')}>Reject</Button>
          </div>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </li>
  );
}
