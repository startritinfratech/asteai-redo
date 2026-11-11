// Pure helpers for the dispute UI (mirrors the API's rules; the API enforces them again).
import { isEvidenceLink, toMinor } from '@asteai/types';
import type { DisputeReasonCode, DisputeResolution, DisputeStatus } from './types';

export const REASON_OPTIONS: { id: DisputeReasonCode; label: string }[] = [
  { id: 'quality', label: 'Quality of the work' },
  { id: 'scope', label: 'Scope disagreement' },
  { id: 'non_delivery', label: 'Work not delivered' },
  { id: 'late', label: 'Late delivery' },
  { id: 'payment', label: 'Payment issue' },
  { id: 'communication', label: 'Communication breakdown' },
  { id: 'other', label: 'Other' },
];
export const REASON_LABEL: Record<string, string> = Object.fromEntries(REASON_OPTIONS.map((o) => [o.id, o.label]));

export const STATUS_LABEL: Record<DisputeStatus, string> = {
  open: 'Open',
  awaiting_response: 'Awaiting response',
  under_review: 'Under review',
  resolved: 'Resolved',
  withdrawn: 'Withdrawn',
};

export const RESOLUTION_OPTIONS: { id: DisputeResolution; label: string }[] = [
  { id: 'release_to_expert', label: 'Release to expert' },
  { id: 'refund_to_buyer', label: 'Refund to buyer' },
  { id: 'split', label: 'Split' },
  { id: 'no_action', label: 'No action' },
];
export const RESOLUTION_LABEL: Record<string, string> = Object.fromEntries(RESOLUTION_OPTIONS.map((o) => [o.id, o.label]));

export function statusColor(s: DisputeStatus): 'mint' | 'amber' | 'rose' | 'grey' {
  if (s === 'resolved') return 'mint';
  if (s === 'open' || s === 'awaiting_response') return 'amber';
  if (s === 'under_review') return 'rose';
  return 'grey';
}

export const isOpenStatus = (s: DisputeStatus) => s === 'open' || s === 'awaiting_response' || s === 'under_review';

/** "5h left to respond", "Overdue by 3h", or null once the respondent no longer owes an answer. */
export function slaLabel(d: { status: DisputeStatus; respondBy: string }, now = Date.now()): string | null {
  if (d.status !== 'open') return null;
  const ms = new Date(d.respondBy).getTime() - now;
  const hours = Math.max(1, Math.round(Math.abs(ms) / 3_600_000));
  const text = hours >= 48 ? `${Math.round(hours / 24)}d` : `${hours}h`;
  return ms < 0 ? `Overdue by ${text}` : `${text} left to respond`;
}

/** Parsed evidence links (one per line) and why they are invalid, if they are. */
export function parseEvidence(text: string): { links: string[]; error: string | null } {
  const links = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (links.length > 10) return { links, error: 'At most 10 evidence links' };
  const bad = links.find((l) => !isEvidenceLink(l));
  return { links, error: bad ? `Evidence links must be https URLs: ${bad.slice(0, 60)}` : null };
}

/** Why the split cannot be submitted against `held`, or null. */
export function splitError(expert: string, buyer: string, held: number): string | null {
  const e = Number(expert);
  const b = Number(buyer);
  if (!expert.trim() || !buyer.trim() || !Number.isFinite(e) || !Number.isFinite(b) || e < 0 || b < 0) {
    return 'Enter both amounts (zero or more)';
  }
  if (toMinor(e) / 100 !== e || toMinor(b) / 100 !== b) return 'At most 2 decimals';
  const diff = toMinor(held) - toMinor(e) - toMinor(b);
  if (diff > 0) return `${diff / 100} of the held amount is not assigned`;
  if (diff < 0) return `The amounts exceed the held amount by ${-diff / 100}`;
  return null;
}
