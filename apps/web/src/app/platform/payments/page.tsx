'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useAuthStore } from '@/store/auth';
import { api, errorMessage, fetcher } from '@/lib/api';
import { Button, Empty, PageHeader, Panel } from '@/components/ui';
import { formatDate, formatInr } from '@/features/billing';
import styles from '@/features/billing/Billing.module.css';

interface UnappliedPayment {
  orderId: string;
  buyerName: string;
  buyerEmail: string;
  amount: number;
  currency: string;
  providerPaymentId: string | null;
  reason: string | null;
  createdAt: string;
}

const KEY = '/payments/unapplied';

/**
 * Admin: payments Razorpay received that AsteAI could not apply (e.g. the contract was
 * cancelled while the buyer was paying). Refunding returns the full amount to the buyer.
 */
export default function UnappliedPaymentsPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'Admin');
  const { data, error, isLoading, mutate } = useSWR<UnappliedPayment[]>(isAdmin ? KEY : null, fetcher);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (!isAdmin) {
    return (
      <div className={styles.page}>
        <PageHeader eyebrow="Admin" title="Unapplied payments" />
        <Empty message="Only admins can see unapplied payments." />
      </div>
    );
  }

  async function refund(p: UnappliedPayment) {
    const amount = formatInr(p.amount, p.currency);
    if (!window.confirm(`Refund ${amount} to ${p.buyerName || p.buyerEmail} through Razorpay? This cannot be undone.`)) return;
    setBusyId(p.orderId);
    setFailure(null);
    try {
      await api.post(`${KEY}/${encodeURIComponent(p.orderId)}/refund`, {});
      await mutate();
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Admin"
        title="Unapplied payments"
        sub="Money Razorpay received that could not be applied to a milestone. Refund it to the buyer."
      />
      {failure && <p className={styles.notice} role="alert">{failure}</p>}
      <Panel className={styles.stack}>
        {isLoading && <Empty message="Loading payments…" />}
        {error && <Empty message="Could not load unapplied payments." />}
        {data && data.length === 0 && <Empty message="Nothing to refund." />}
        {data && data.length > 0 && (
          <table>
            <thead>
              <tr><th>Buyer</th><th>Amount</th><th>Razorpay payment</th><th>Reason</th><th>Received</th><th /></tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.orderId}>
                  <td>{p.buyerName}<br /><span className={styles.muted}>{p.buyerEmail}</span></td>
                  <td>{formatInr(p.amount, p.currency)}</td>
                  <td className={styles.mono}>{p.providerPaymentId ?? '—'}</td>
                  <td>{p.reason ?? '—'}</td>
                  <td>{formatDate(p.createdAt)}</td>
                  <td><Button onClick={() => void refund(p)} disabled={busyId === p.orderId}>Refund</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
