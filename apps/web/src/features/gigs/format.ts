import type { GigOrderStatus, PackageTier, ServiceStatus } from '@asteai/types';
import type { TagColor } from '@/components/ui';

export const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);

export const SERVICE_STATUS_LABEL: Record<ServiceStatus, string> = {
  draft: 'Draft', pending: 'In review', published: 'Published', paused: 'Paused', rejected: 'Rejected',
};
export const SERVICE_STATUS_COLOR: Record<ServiceStatus, TagColor> = {
  draft: 'grey', pending: 'amber', published: 'mint', paused: 'gold', rejected: 'rose',
};

export const ORDER_STATUS_LABEL: Record<GigOrderStatus, string> = {
  awaiting_payment: 'Awaiting payment',
  in_progress: 'In progress',
  delivered: 'Delivered',
  revision_requested: 'Revision requested',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
export const ORDER_STATUS_COLOR: Record<GigOrderStatus, TagColor> = {
  awaiting_payment: 'amber', in_progress: 'gold', delivered: 'amber', revision_requested: 'amber',
  completed: 'mint', cancelled: 'rose',
};

export const TIER_LABEL: Record<PackageTier, string> = { basic: 'Basic', standard: 'Standard', premium: 'Premium' };

export function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Steps of an order's timeline: [label, done, current]. Cancelled orders show a single step. */
export function timeline(status: GigOrderStatus): { label: string; done: boolean; current: boolean }[] {
  if (status === 'cancelled') return [{ label: 'Order placed', done: true, current: false }, { label: 'Cancelled', done: true, current: true }];
  const order: GigOrderStatus[] = ['awaiting_payment', 'in_progress', 'delivered', 'completed'];
  // A revision request sends the order back to the expert: show it as the in-progress step.
  const at = status === 'revision_requested' ? 1 : order.indexOf(status);
  const labels = ['Order placed, awaiting payment', 'Paid, work in progress', 'Delivered, awaiting your review', 'Accepted and paid out'];
  return labels.map((label, i) => ({ label, done: i < at || status === 'completed', current: i === at && status !== 'completed' }));
}
