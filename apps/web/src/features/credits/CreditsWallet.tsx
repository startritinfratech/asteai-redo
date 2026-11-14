'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import useSWRInfinite from 'swr/infinite';
import type { CreditPack, CreditTransactionView, PublicCreditSettings, WalletView } from '@asteai/types';
import { errorMessage, fetcher } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button, Dialog, Empty, Panel, Tag } from '@/components/ui';
import {
  CREDIT_PACKS_KEY, CREDIT_PAGE_SIZE, CREDIT_SETTINGS_KEY, CREDIT_WALLET_KEY, creditTransactionsKey,
} from './api';
import {
  bestValuePackId, canUpgradeToPro, formatCredits, formatDay, formatPaise, lotDetail, nextLotIds, perCredit,
  planSummary, signedAmount, txStatus, txTitle,
} from './format';
import { buyCreditPack, PURCHASE_MESSAGES, subscribeToPro } from './purchase';
import styles from './Credits.module.css';

const PRO_PRICE_MINOR = 49900;
const PRO_MONTHLY_CREDITS = 100;

type Banner = { tone: 'ok' | 'info' | 'error'; text: string } | null;

/**
 * AI credits on /platform/wallet: balance and plan, bulk top-up packs (Razorpay
 * Checkout), the Pro upgrade, and the credit history in FIFO terms (which lots are left,
 * which the next spend draws from, when they expire).
 */
export function CreditsWallet({ focusUpgrade = false }: { focusUpgrade?: boolean }) {
  const user = useAuthStore((s) => s.user);
  const { mutate } = useSWRConfig();
  const { data: wallet, error: walletError } = useSWR<WalletView>(CREDIT_WALLET_KEY, fetcher);
  const { data: packs, error: packsError } = useSWR<CreditPack[]>(CREDIT_PACKS_KEY, fetcher);
  const { data: settings } = useSWR<PublicCreditSettings>(CREDIT_SETTINGS_KEY, fetcher);
  const history = useSWRInfinite<CreditTransactionView[]>(
    (index, prev: CreditTransactionView[] | null) =>
      (prev && prev.length < CREDIT_PAGE_SIZE ? null : creditTransactionsKey(index + 1)),
    fetcher,
  );

  const [chosen, setChosen] = useState<CreditPack | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const planRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (focusUpgrade) planRef.current?.scrollIntoView({ block: 'center' });
  }, [focusUpgrade]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const labels = useMemo(() => new Map((settings?.costs ?? []).map((c) => [c.feature, c.label])), [settings]);
  const txs = useMemo(() => (history.data ?? []).flat(), [history.data]);
  const nextLots = useMemo(() => new Set(nextLotIds(txs).slice(0, 1)), [txs]);
  const best = packs ? bestValuePackId(packs) : null;
  const prefill = user ? { name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(), email: user.email } : undefined;

  const refresh = () => {
    void mutate(CREDIT_WALLET_KEY);
    void history.mutate();
  };
  /** The webhook usually lands within seconds of checkout; look again a couple of times. */
  const refreshSoon = () => {
    refresh();
    timers.current.push(setTimeout(refresh, 4_000), setTimeout(refresh, 12_000));
  };

  async function buy(pack: CreditPack) {
    // Close our dialog first: a modal <dialog> sits in the top layer, above Razorpay's iframe.
    setChosen(null);
    setBusy(pack.id);
    setBanner(null);
    try {
      const out = await buyCreditPack(pack.id, prefill);
      if (out.kind === 'credited') setBanner({ tone: 'ok', text: PURCHASE_MESSAGES.credited(out.credits) });
      else if (out.kind === 'pending') setBanner({ tone: 'info', text: PURCHASE_MESSAGES.pending });
      else if (out.kind === 'failed') setBanner({ tone: 'error', text: PURCHASE_MESSAGES.failed(out.message) });
      else setBanner({ tone: 'info', text: PURCHASE_MESSAGES.dismissed });
      if (out.kind === 'credited' || out.kind === 'pending') refreshSoon();
      else refresh(); // the pending top-up row shows in the history
    } catch (err) {
      setBanner({ tone: 'error', text: errorMessage(err, 'Could not start the payment. Please try again.') });
    } finally {
      setBusy(null);
    }
  }

  async function upgrade() {
    setBusy('pro');
    setBanner(null);
    try {
      const out = await subscribeToPro(prefill);
      if (out.kind === 'activating') {
        setBanner({ tone: 'info', text: PURCHASE_MESSAGES.activating });
        refreshSoon();
      } else if (out.kind === 'failed') {
        setBanner({ tone: 'error', text: PURCHASE_MESSAGES.failed(out.message) });
      } else {
        setBanner({ tone: 'info', text: PURCHASE_MESSAGES.dismissed });
      }
    } catch (err) {
      setBanner({ tone: 'error', text: errorMessage(err, 'Could not start the subscription. Please try again.') });
    } finally {
      setBusy(null);
    }
  }

  const lastPage = history.data?.[history.data.length - 1];
  const hasMore = !!lastPage && lastPage.length === CREDIT_PAGE_SIZE;

  return (
    <section className={styles.section} aria-labelledby="credits-heading">
      <h2 id="credits-heading" className={styles.h2}>AI credits</h2>

      {banner && (
        <p className={styles[banner.tone]} role={banner.tone === 'error' ? 'alert' : 'status'}>{banner.text}</p>
      )}

      <div className={styles.top}>
        <Panel className={styles.balance}>
          <span className={styles.label}>Balance</span>
          {walletError ? (
            <p className={styles.error}>Could not load your credits.</p>
          ) : (
            <>
              <span className={styles.big}>{wallet ? wallet.balance.toLocaleString('en-IN') : '—'}</span>
              <span className={styles.muted}>{wallet ? planSummary(wallet) : 'Loading…'}</span>
            </>
          )}
          <p className={styles.muted}>
            Credits pay for AI features and are spent oldest first. If an AI feature fails, its credits come back automatically.
          </p>
        </Panel>

        <div ref={planRef} className={styles.planWrap}>
          <Panel className={focusUpgrade ? `${styles.plan} ${styles.focus}` : styles.plan}>
            <span className={styles.label}>Plan</span>
            {wallet && canUpgradeToPro(wallet) ? (
              <>
                <p className={styles.planName}>
                  Pro <span className={styles.muted}>{formatPaise(PRO_PRICE_MINOR)}/month</span>
                </p>
                <p className={styles.muted}>
                  {PRO_MONTHLY_CREDITS} credits every month (they expire at the end of each billing month) and the Pro features.
                  Cancel any time.
                </p>
                <Button variant="primary" disabled={busy !== null} onClick={() => { void upgrade(); }}>
                  {busy === 'pro' ? 'Opening checkout…' : 'Upgrade to Pro'}
                </Button>
              </>
            ) : wallet ? (
              <>
                <p className={styles.planName}>{planSummary(wallet)}</p>
                <p className={styles.muted}>Plan credits arrive with each monthly payment.</p>
              </>
            ) : (
              <p className={styles.muted}>Loading…</p>
            )}
          </Panel>
        </div>
      </div>

      <Panel className={styles.stack}>
        <div className={styles.between}>
          <h3 className={styles.h3}>Top up</h3>
          <span className={styles.muted}>Bigger packs save up to 30%. Top-up credits never expire.</span>
        </div>
        {packsError ? (
          <Empty message="Credit purchases are unavailable right now." />
        ) : !packs ? (
          <Empty message="Loading…" />
        ) : packs.length === 0 ? (
          <Empty message="No credit packs are on sale right now." />
        ) : (
          <ul className={styles.packs}>
            {packs.map((p) => (
              <li key={p.id} className={p.id === best ? `${styles.pack} ${styles.best}` : styles.pack}>
                <div className={styles.between}>
                  <span className={styles.packCredits}>{formatCredits(p.credits)}</span>
                  {p.discountPercent > 0 && <Tag color={p.id === best ? 'mint' : 'gold'}>Save {p.discountPercent}%</Tag>}
                </div>
                <p className={styles.price}>
                  {formatPaise(p.priceMinor)}
                  {p.listPriceMinor > p.priceMinor && (
                    <s className={styles.was} aria-label={`was ${formatPaise(p.listPriceMinor)}`}>{formatPaise(p.listPriceMinor)}</s>
                  )}
                </p>
                <span className={styles.muted}>{perCredit(p)}{p.id === best ? ' · best value' : ''}</span>
                <Button variant={p.id === best ? 'mint' : 'default'} disabled={busy !== null} onClick={() => setChosen(p)}>
                  {busy === p.id ? 'Opening checkout…' : 'Buy'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className={styles.stack}>
        <div className={styles.between}>
          <h3 className={styles.h3}>Credit history</h3>
          <span className={styles.muted}>Newest first. Spends use the oldest credits that are left.</span>
        </div>
        {history.error ? (
          <Empty message="Could not load your credit history." />
        ) : !history.data ? (
          <Empty message="Loading…" />
        ) : txs.length === 0 ? (
          <Empty message="No credit activity yet." />
        ) : (
          <>
            <ul className={styles.history}>
              {txs.map((tx) => {
                const status = txStatus(tx);
                const detail = lotDetail(tx);
                return (
                  <li key={tx.id} className={styles.item}>
                    <div className={styles.itemMain}>
                      <span className={styles.itemTitle}>{txTitle(tx, labels)}</span>
                      <div className={styles.row}>
                        <span className={styles.muted}>{formatDay(tx.createdAt)}</span>
                        {status && <Tag color={status.color}>{status.label}</Tag>}
                        {nextLots.has(tx.id) && <Tag color="gold">Spent next</Tag>}
                        {detail && <span className={styles.muted}>{detail}</span>}
                      </div>
                    </div>
                    <span className={tx.amount > 0 && tx.status !== 'pending' ? `${styles.amount} ${styles.credit}` : styles.amount}>
                      {signedAmount(tx)}
                    </span>
                  </li>
                );
              })}
            </ul>
            {hasMore && (
              <Button disabled={history.isValidating} onClick={() => { void history.setSize(history.size + 1); }}>
                {history.isValidating ? 'Loading…' : 'Show older'}
              </Button>
            )}
          </>
        )}
      </Panel>

      <Dialog
        open={chosen !== null}
        onOpenChange={(open) => { if (!open) setChosen(null); }}
        title="Buy credits"
        size="sm"
        description={chosen ? `${formatCredits(chosen.credits)} for ${formatPaise(chosen.priceMinor)}.` : undefined}
        footer={chosen && (
          <>
            <Button onClick={() => setChosen(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => { void buy(chosen); }}>Pay {formatPaise(chosen.priceMinor)}</Button>
          </>
        )}
      >
        {chosen && (
          <ul className={styles.summary}>
            <li><span>Credits</span><span>{chosen.credits.toLocaleString('en-IN')}</span></li>
            {chosen.discountPercent > 0 && (
              <li><span>You save</span><span>{formatPaise(chosen.listPriceMinor - chosen.priceMinor)} ({chosen.discountPercent}%)</span></li>
            )}
            <li><span>Price</span><span>{perCredit(chosen)}</span></li>
            <li><span>Validity</span><span>No expiry</span></li>
            <li className={styles.muted}>Payment opens in Razorpay’s secure checkout (cards, UPI, netbanking).</li>
          </ul>
        )}
      </Dialog>
    </section>
  );
}
