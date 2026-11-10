import { PROJECT_STAGES, type ProjectStage } from '@asteai/types';

/** Who is asking, relative to one project. */
export interface ProjectParty {
  isAdmin: boolean;
  isBuyer: boolean;
  isFreelancer: boolean; // the freelancer the project was awarded to
}

// Milestone moves used to live here (PATCH /projects/:id/milestones/:mid). That route is
// retired (410): milestones and escrow are on contracts now (modules/contracts/contract-rules.ts).

/** Stages that only make sense once a bid has been awarded. */
const AWARDED_STAGES: readonly ProjectStage[] = PROJECT_STAGES.slice(PROJECT_STAGES.indexOf('Contracted'));

/**
 * Project stages only move forward along PROJECT_STAGES, and only the buyer moves them
 * (admins may set any stage). The buyer can't reach 'Contracted' or later without an
 * awarded freelancer: awarding a proposal is what contracts a project.
 */
export function canMoveProjectStage(
  party: ProjectParty, from: ProjectStage, to: ProjectStage, awarded: boolean,
): boolean {
  if (from === to) return false;
  if (party.isAdmin) return true;
  if (!party.isBuyer) return false;
  if (PROJECT_STAGES.indexOf(to) <= PROJECT_STAGES.indexOf(from)) return false;
  return awarded || !AWARDED_STAGES.includes(to);
}
