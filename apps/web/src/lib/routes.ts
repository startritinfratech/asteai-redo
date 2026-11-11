import type { UserRole } from '@asteai/types';

export const LOGIN_PATH = '/auth/login';

/** Where each role lands after sign-in. Every target must be a built page. */
export const ROLE_HOME: Record<UserRole, string> = {
  Employer: '/platform/requisitions',
  Candidate: '/platform/applications',
  Freelancer: '/platform/passport',
  Buyer: '/platform/projects',
  Admin: '/platform/admin',
};

export interface NavItem {
  slug: string;
  label: string;
  /** False for sections whose page has not been built yet: shown, but not linked. */
  ready?: boolean;
}

export type NavSection = [group: string, items: NavItem[]];

const item = (slug: string, label: string, ready = true): NavItem => ({ slug, label, ready });

export const NAV: Record<UserRole, NavSection[]> = {
  Employer: [
    ['Hire & ATS', [
      item('requisitions', 'Requisitions'),
      item('pipeline', 'Applications Pipeline'),
      item('interviews', 'Interviews & Offers'),
      item('pools', 'Talent CRM'),
      item('outreach', 'Bulk Outreach'),
    ]],
    ['Intelligence', [
      item('analytics', 'Analytics & Fairness'),
      item('integrity', 'Integrity Queue'),
    ]],
    ['Account', [
      item('messages', 'Messages'),
      item('billing', 'Billing & Credits'),
      item('team', 'Team & Roles'),
      item('verify', 'Verify a Passport'),
      item('security', 'Security'),
    ]],
  ],
  Candidate: [
    ['Careers & AI Prep', [
      item('applications', 'My Applications'),
      item('assess', 'Take Assessment'),
      item('passport', 'Talent Passport'),
      item('certificates', 'Certificates'),
      item('studio', 'AI Interview Studio'),
    ]],
    ['Account', [
      item('messages', 'Messages'),
      item('privacy', 'Privacy & Consent'),
      item('verify', 'Verify a Passport'),
      item('security', 'Security'),
    ]],
  ],
  Freelancer: [
    ['Marketplace', [
      item('market', 'Find Projects'),
      item('proposals', 'My Proposals'),
      item('my-services', 'My Services'),
      item('orders', 'Orders'),
      item('contracts', 'Escrow Contracts'),
      item('wallet', 'Wallet'),
      item('invoices', 'Invoices'),
      item('passport', 'Talent Passport'),
    ]],
    ['Account', [
      item('messages', 'Messages'),
      item('profile', 'My Profile'),
      item('privacy', 'Privacy & Consent'),
      item('security', 'Security'),
    ]],
  ],
  Buyer: [
    ['Talent Sourcing', [
      item('experts', 'Find Experts'),
      item('projects', 'My Projects'),
      item('services', 'Pre-Packaged Services'),
      item('orders', 'Orders'),
      item('contracts', 'Escrow Contracts'),
      item('wallet', 'Wallet'),
      item('invoices', 'Invoices'),
      item('disputes', 'Disputes'),
    ]],
    ['Account', [
      item('messages', 'Messages'),
      item('profile', 'Company Profile'),
      item('verify', 'Verify a Passport'),
      item('security', 'Security'),
    ]],
  ],
  Admin: [
    ['Master Control', [
      item('admin', 'Master Control'),
      item('ai-interviews', 'AI Interviews'),
      item('assessment-sessions', 'Assessment Sessions'),
      item('expert-approvals', 'Expert Approvals'),
      item('service-approvals', 'Service Approvals'),
      item('payouts', 'Expert Payouts'),
      item('payments', 'Unapplied Payments'),
      item('invoices', 'Invoices'),
      item('tenants', 'Tenants & Plans'),
      item('integrity', 'Integrity Review'),
      item('trust', 'Trust & Safety'),
      item('disputes', 'Disputes & Appeals'),
      item('flags', 'Feature Flags'),
      item('auditlog', 'Audit Log'),
    ]],
    ['Growth & Marketing', [
      item('mkt/studio', 'Ad Studio'),
      item('mkt/campaigns', 'Campaigns'),
      item('mkt/audiences', 'Audiences'),
      item('mkt/report', 'Performance'),
    ]],
    ['Account', [
      item('messages', 'Messages'),
      item('security', 'Security'),
    ]],
  ],
};
