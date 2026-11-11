import { BadRequestException } from '@nestjs/common';
import { toMinor, type GigOrderStatus, type PackageTier, type ServiceStatus } from '@asteai/types';

export { gigOrderStatusFor } from '@asteai/types';

/** Services whose content the expert may still edit; editing sends a paused service back to draft. */
export const EDITABLE: readonly ServiceStatus[] = ['draft', 'rejected', 'paused'];
/** Statuses an expert may submit for review from. */
export const SUBMITTABLE: readonly ServiceStatus[] = ['draft', 'rejected'];
/** Admin decisions allowed from each status. */
export const ADMIN_DECISIONS: Record<ServiceStatus, readonly ('published' | 'rejected')[]> = {
  draft: [],
  pending: ['published', 'rejected'],
  published: ['rejected'], // taking a live service down
  paused: ['rejected'],
  rejected: [],
};

/** Order statuses in which the expert may deliver. */
export const DELIVERABLE: readonly GigOrderStatus[] = ['in_progress', 'revision_requested'];

export function slugify(title: string): string {
  const base = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100)
    .replace(/-+$/g, '');
  return base || 'service';
}

/** "Aarav Sharma" becomes "Aarav S." Never anything more identifying than that. */
export function publicName(first: string | null | undefined, last: string | null | undefined): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  if (!f && !l) return 'AsteAI expert';
  return l ? `${f} ${[...l][0].toUpperCase()}.`.trim() : f;
}

export function isHttpsLink(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname.includes('.') && value.length <= 500;
  } catch {
    return false;
  }
}

/** Trims, de-duplicates (case-insensitively) and drops empty entries. */
export function cleanList(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const v = raw.trim().replace(/\s+/g, ' ');
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

export interface PackageLike { tier: PackageTier; price: number }

/** 1 to 3 packages, one per tier, each priced above zero. */
export function assertPackageSet(packages: PackageLike[]): void {
  if (packages.length < 1 || packages.length > 3) throw new BadRequestException('A service has 1 to 3 packages');
  const tiers = new Set(packages.map((p) => p.tier));
  if (tiers.size !== packages.length) throw new BadRequestException('Each tier (basic, standard, premium) can be used once');
  for (const p of packages) {
    if (!(toMinor(p.price) > 0)) throw new BadRequestException('A package price must be above zero');
  }
}

/** What stops a service being submitted for review, or null. */
export function submitProblem(service: { summary: string; description: string }, packageCount: number): string | null {
  if (packageCount < 1) return 'Add at least one package before submitting';
  if (!service.summary.trim()) return 'Add a summary before submitting';
  if (!service.description.trim()) return 'Add a description before submitting';
  return null;
}

/** Composes the milestone submission note from a delivery (the contract note is capped at 4000). */
export function deliveryNote(note: string, links: string[]): string {
  const text = links.length ? `${note.trim()}\n\nLinks:\n${links.join('\n')}` : note.trim();
  return text.slice(0, 4000);
}
