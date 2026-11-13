/** Job board display helpers; the contract itself lives in @asteai/types (GET /jobs/public). */
import {
  EMPLOYMENT_TYPES, JOB_LOCATION_TYPES,
  type EmploymentType, type JobLocationType, type PublicJob, type PublicJobPage,
} from '@asteai/types';

export { EMPLOYMENT_TYPES };
export const LOCATION_TYPES = JOB_LOCATION_TYPES;
export type LocationType = JobLocationType;
export type { EmploymentType, PublicJob, PublicJobPage };

export const LOCATION_TYPE_LABEL: Record<LocationType, string> = { onsite: 'On-site', remote: 'Remote', hybrid: 'Hybrid' };
export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', internship: 'Internship',
};

export function formatSalary(job: Pick<PublicJob, 'salaryMin' | 'salaryMax' | 'salaryCurrency'>): string | null {
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: job.salaryCurrency || 'INR', maximumFractionDigits: 0, notation: 'compact' }).format(n);
  if (job.salaryMin != null && job.salaryMax != null) return `${fmt(job.salaryMin)} – ${fmt(job.salaryMax)}`;
  if (job.salaryMin != null) return `from ${fmt(job.salaryMin)}`;
  if (job.salaryMax != null) return `up to ${fmt(job.salaryMax)}`;
  return null;
}
