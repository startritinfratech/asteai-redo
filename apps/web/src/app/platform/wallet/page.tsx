'use client';

import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import type { LedgerEntry } from '@asteai/types';
import { useAuthStore } from '@/store/auth';
import { fetcher } from '@/lib/api';
import { Empty, KPI, PageHeader, Panel, Tag } from '@/components/ui';
import {
  formatDate, formatInr, LEDGER_ENTRIES_KEY, PAYOUT_ACCOUNT_KEY, PayoutAccountForm, PAYOUTS_KEY, PayoutsPanel, WALLET_KEY,
  type PayoutAccount, type PayoutOverview, type WalletBalances,
} from '@/features/billing';
import styles from '@/features/billing/Billing.module.css';

/**
 * Wallet. Experts: earnings, escrow held for them, payout account and payout requests.
 * Buyers: money paid into escrow, released, refunded and still held. Every role: the
 * ledger rows that touch them.
 */
export default function WalletPage() {
  const role = useAuthStore((s) => s.user?.role);
  const isExpert = role === 'Freelancer';
  const { data: wallet, error } = useSWR<WalletBalances>(WALLET_KEY, fetcher);
  const { data: entries } = useSWR<LedgerEntry[]>(LEDGER_ENTRIES_KEY, fetcher);
  const { data: account, mutate: mutateAccount } = useSWR<PayoutAccount | null>(isExpert ? PAYOUT_ACCOUNT_KEY : null, fetcher);
  const { data: overview } = useSWR<PayoutOverview>(isExpert ? PAYOUTS_KEY : null, fetcher);
  const { mutate } = useSWRConfig();

  const refresh = () => {
    void mutate(WALLET_KEY);
    void mutate(PAYOUTS_KEY);
    void mutate(LEDGER_ENTRIES_KEY);
  };

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Finance & Payouts"
        title="Wallet"
        sub={isExpert
          ? 'What you have earned, what buyers hold in escrow for you, and your payouts.'
          : 'What you have paid into escrow, what has been released to experts, and refunds.'}
        actions={<Link href="/platform/invoices">Invoices</Link>}
      />

      {error && <Empty message="Could not load your wallet." />}

      {wallet && isExpert && (
        <div className={styles.kpis}>
          <KPI value={formatInr(wallet.expert.available)} label="Available to withdraw" />
          <KPI value={formatInr(wallet.expert.inEscrow)} label="In escrow for you" />
          <KPI value={formatInr(wallet.expert.earned)} label="Released to you (lifetime)" />
          <KPI value={formatInr(wallet.expert.paidOut)} label="Paid out" />
          {wallet.expert.payoutsPending > 0 && <KPI value={formatInr(wallet.expert.payoutsPending)} label="Payouts in progress" />}
          {wallet.expert.fees > 0 && <KPI value={formatInr(wallet.expert.fees)} label="Platform fees" />}
        </div>
      )}

      {wallet && !isExpert && (
        <div className={styles.kpis}>
          <KPI value={formatInr(wallet.buyer.inEscrow)} label="Held in escrow" />
          <KPI value={formatInr(wallet.buyer.funded)} label="Paid into escrow" />
          <KPI value={formatInr(wallet.buyer.released)} label="Released to experts" />
          <KPI value={formatInr(wallet.buyer.refunded)} label="Refunded to you" />
          {wallet.buyer.refundDue > 0 && <KPI value={formatInr(wallet.buyer.refundDue)} label="Refund due to you" />}
        </div>
      )}

      {role === 'Admin' && (
        <p className={styles.muted}>
          Expert payout requests are handled in the <Link href="/platform/payouts">payout queue</Link>.
        </p>
      )}

      {isExpert && (
        <div className={styles.columns}>
          <Panel className={styles.stack}>
            <h3 className={styles.h2}>Payout account</h3>
            {account === undefined ? (
              <Empty message="Loading…" />
            ) : (
              <PayoutAccountForm account={account} onSaved={(a) => { void mutateAccount(a, { revalidate: false }); }} />
            )}
          </Panel>
          <Panel className={styles.stack}>
            <h3 className={styles.h2}>Request a payout</h3>
            <PayoutsPanel overview={overview} account={account ?? null} onChanged={refresh} />
          </Panel>
        </div>
      )}

      <Panel className={styles.stack}>
        <h3 className={styles.h2}>Ledger</h3>
        {!entries ? (
          <Empty message="Loading…" />
        ) : entries.length === 0 ? (
          <Empty message="No wallet transactions yet." />
        ) : (
          <ul className={styles.list}>
            {entries.map((tx) => (
              <li key={tx.id} className={styles.item}>
                <div className={styles.itemMain}>
                  <span className={styles.itemTitle}>{tx.description}</span>
                  <div className={styles.row}>
                    <Tag color={tx.amount >= 0 ? 'mint' : 'grey'}>{tx.type}</Tag>
                    <span className={styles.muted}>{formatDate(tx.t)}</span>
                    <span className={`${styles.muted} ${styles.mono}`}>{tx.id}</span>
                  </div>
                </div>
                <span className={`${styles.amount} ${tx.amount >= 0 ? styles.credit : ''}`}>
                  {tx.amount >= 0 ? '+' : '−'}{formatInr(Math.abs(tx.amount), tx.unit || 'INR')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
