/**
 * Pure helpers for the credits wallet (tested in format.spec.ts). Amounts from the API are
 * whole credits and paise; nothing here re-prices anything, it only describes it.
 */
import type { CreditPack, CreditTransactionView, SubscriptionTier, WalletView } from '@asteai/types';
import type { TagColor } from '@/components/ui';

export function formatCredits(n: number): string {
  return `${n.toLocaleString('en-IN')} credit${Math.abs(n) === 1 ? '' : 's'}`;
}

/** ₹ from paise; whole rupees print without decimals. */
export function formatPaise(minor: number): string {
  const rupees = minor / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
  }).format(rupees);
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** e.g. "₹4.50 per credit". */
export function perCredit(pack: Pick<CreditPack, 'priceMinor' | 'credits'>): string {
  return `${formatPaise(Math.round(pack.priceMinor / pack.credits))} per credit`;
}

/** The pack with the biggest discount (the "best value" badge), or null if none is discounted. */
export function bestValuePackId(packs: readonly CreditPack[]): string | null {
  let best: CreditPack | null = null;
  for (const p of packs) if (p.discountPercent > 0 && (!best || p.discountPercent > best.discountPercent)) best = p;
  return best?.id ?? null;
}

export const TIER_LABEL: Record<SubscriptionTier, string> = { free: 'Free', pro: 'Pro', enterprise: 'Enterprise' };

/** One line about the plan under the balance. */
export function planSummary(w: WalletView): string {
  const tier = TIER_LABEL[w.subscriptionTier];
  if (w.subscriptionTier === 'free') {
    return w.subscriptionStatus === 'created' || w.subscriptionStatus === 'authenticated'
      ? 'Free plan · Pro checkout started, waiting for the first payment'
      : 'Free plan';
  }
  if (w.subscriptionStatus === 'active' && w.currentPeriodEnd) return `${tier} plan · renews ${formatDay(w.currentPeriodEnd)}`;
  if (w.subscriptionStatus === 'pending') return `${tier} plan · payment retrying with your bank`;
  return `${tier} plan`;
}

/** Whether to offer the Pro upgrade. */
export function canUpgradeToPro(w: WalletView): boolean {
  return w.subscriptionTier === 'free';
}

const isLot = (tx: CreditTransactionView) => tx.type !== 'spend';

export function txTitle(tx: CreditTransactionView, labels: ReadonlyMap<string, string>): string {
  const feature = tx.featureKey ? labels.get(tx.featureKey) ?? tx.featureKey.replace(/_/g, ' ') : null;
  switch (tx.type) {
    case 'spend': return feature ?? 'AI feature';
    case 'refund': return feature ? `Refund · ${feature}` : 'Refund';
    case 'topup': return 'Credit top-up';
    case 'grant': return 'Plan & bonus credits';
  }
}

/** Status shown as a tag, or null for the ordinary case. */
export function txStatus(tx: CreditTransactionView, now = new Date()): { label: string; color: TagColor } | null {
  if (tx.status === 'pending') return { label: 'Awaiting payment', color: 'amber' };
  if (tx.status === 'failed') return { label: 'Payment failed', color: 'rose' };
  if (tx.status === 'refunded') return { label: 'Refunded', color: 'mint' };
  if (tx.status === 'expired' || (isLot(tx) && tx.expiresAt && new Date(tx.expiresAt) <= now && tx.remainingAmount > 0)) {
    return { label: 'Expired', color: 'grey' };
  }
  if (isLot(tx) && tx.remainingAmount === 0 && tx.amount > 0 && tx.type !== 'refund') return { label: 'Used up', color: 'grey' };
  return null;
}

/**
 * The FIFO detail of a credit lot: how much of it is left to spend and until when. Spends
 * draw from the oldest lot first, so this is what the next spend will use.
 */
export function lotDetail(tx: CreditTransactionView): string | null {
  if (!isLot(tx) || tx.status !== 'completed') return null;
  const parts: string[] = [];
  if (tx.remainingAmount > 0) parts.push(`${tx.remainingAmount.toLocaleString('en-IN')} of ${tx.amount.toLocaleString('en-IN')} left`);
  if (tx.expiresAt) parts.push(`${new Date(tx.expiresAt) > new Date() ? 'expires' : 'expired'} ${formatDay(tx.expiresAt)}`);
  return parts.length ? parts.join(' · ') : null;
}

/** "+120" / "−15"; a pending top-up has not added anything yet. */
export function signedAmount(tx: CreditTransactionView): string {
  const n = Math.abs(tx.amount).toLocaleString('en-IN');
  return tx.amount < 0 ? `−${n}` : `+${n}`;
}

/** Which live lots the next spend draws from, oldest first (what the history highlights). */
export function nextLotIds(txs: readonly CreditTransactionView[], now = new Date()): string[] {
  return txs
    .filter((t) => isLot(t) && t.status === 'completed' && t.remainingAmount > 0 && (!t.expiresAt || new Date(t.expiresAt) > now))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((t) => t.id);
}
