'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useAuthStore } from '@/store/auth';
import { errorMessage, fetcher } from '@/lib/api';
import { Button, Empty, PageHeader, Panel, Tag } from '@/components/ui';
import { downloadInvoicePdf, formatDate, formatInr, INVOICES_KEY, type Invoice } from '@/features/billing';
import styles from '@/features/billing/Billing.module.css';

/**
 * Invoices for escrow payments: one per captured milestone payment. Buyers and experts
 * see the invoices of their contracts; admins see all.
 */
export default function InvoicesPage() {
  const user = useAuthStore((s) => s.user);
  const { data: invoices, error, isLoading } = useSWR<Invoice[]>(INVOICES_KEY, fetcher);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Finance & Payouts"
        title="Invoices"
        sub="An invoice is issued for every milestone payment into escrow. Download any of them as a PDF."
      />

      <Panel className={styles.stack}>
        {isLoading && <Empty message="Loading invoices…" />}
        {error && <Empty message="Could not load invoices." />}
        {invoices && invoices.length === 0 && (
          <Empty message="No invoices yet. One is issued when a milestone payment into escrow is received." />
        )}
        {invoices && invoices.length > 0 && (
          <ul className={styles.list}>
            {invoices.map((inv) => <InvoiceItem key={inv.id} invoice={inv} userId={user?.id} />)}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function InvoiceItem({ invoice: inv, userId }: { invoice: Invoice; userId?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const side = inv.buyerId === userId ? 'Paid by you' : inv.expertId === userId ? 'Paid in for you' : null;

  async function download() {
    setBusy(true);
    setError(null);
    try {
      await downloadInvoicePdf(inv.id);
    } catch (err) {
      setError(errorMessage(err, 'Could not download the invoice'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={styles.item}>
      <div className={styles.itemMain}>
        <span className={styles.itemTitle}>{inv.projectTitle || inv.contractId}</span>
        <span className={styles.muted}>Milestone {inv.milestoneSeq}: {inv.milestoneTitle}</span>
        <div className={styles.row}>
          <span className={styles.mono}>{inv.id}</span>
          <span className={styles.muted}>{formatDate(inv.issuedAt)}</span>
          {side && <Tag color={side === 'Paid by you' ? 'default' : 'mint'}>{side}</Tag>}
          <Link className={styles.muted} href={`/platform/contracts/${encodeURIComponent(inv.contractId)}`}>{inv.contractId}</Link>
        </div>
      </div>
      <span className={styles.amount}>{formatInr(inv.total, inv.currency)}</span>
      <div className={styles.itemFull}>
        <div className={styles.actions}>
          <Button variant="sm" onClick={() => void download()} disabled={busy}>{busy ? 'Preparing…' : 'Download PDF'}</Button>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </li>
  );
}
