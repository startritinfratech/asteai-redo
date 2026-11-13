/**
 * Seeded demo accounts (packages/db/seed.mjs) for the sign-in page's one-click pills.
 *
 * Only loaded through a dynamic import() guarded by an inline build-time condition in
 * LoginForm, so a production build without NEXT_PUBLIC_DEMO_LOGIN=true drops the import and
 * never emits this module: the demo password and the seeded admin address don't ship.
 */
export const DEMO_PASSWORD = 'Password123!';

export interface DemoAccount {
  label: string;
  email: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { label: 'Admin', email: 'ops@asteai.com' },
  { label: 'Employer', email: 'priya@meridianhospitals.in' },
  { label: 'Candidate', email: 'rahul.g@gmail.com' },
  { label: 'Freelancer', email: 'aarav@dev.in' },
  { label: 'Buyer', email: 'nikhil@novastack.io' },
];
