import type { ProductStatus } from '@asteai/types';

/** Statuses in which the seller may edit the listing (active must be paused first). */
export const EDITABLE: readonly ProductStatus[] = ['draft', 'rejected', 'paused'];
export const SUBMITTABLE: readonly ProductStatus[] = ['draft', 'rejected'];

/** Allowed seller-driven moves (admin review is separate: pending → active | rejected). */
export const SELLER_MOVES: Readonly<Record<'submit' | 'pause' | 'resume', { from: readonly ProductStatus[]; to: ProductStatus }>> = {
  submit: { from: SUBMITTABLE, to: 'pending' },
  pause: { from: ['active'], to: 'paused' },
  // A product edited while paused goes back through review (see ProductsService.update).
  resume: { from: ['paused'], to: 'active' },
};

/** What still blocks submission, or null when the listing can be reviewed. */
export function submitProblem(p: { summary: string; description: string; tags: string[] }): string | null {
  if (p.summary.trim().length < 20) return 'Add a summary of at least 20 characters before submitting';
  if (p.description.trim().length < 80) return 'Add a description of at least 80 characters before submitting';
  if (!p.tags.length) return 'Add at least one tag before submitting';
  return null;
}
