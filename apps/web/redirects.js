/**
 * Permanent redirects from the legacy SPA's URLs (deeptech_frontend, live at asteai.com) to
 * the routes in this app, so links, bookmarks and search rankings carry over.
 * Source of truth: ASTEAI_REDO_SPEC.md §1d. Query strings are passed through by Next.
 *
 * Order matters: Next uses the first match, so specific paths come before patterns.
 * Kept in plain CommonJS so next.config.js can require it and the spec can test it.
 */

/** @param {string} source @param {string} destination */
const r = (source, destination) => ({ source, destination, permanent: true });

const register = (role) => `/auth/register?role=${role}`;

const LEGACY_REDIRECTS = [
  // ── Company & legal pages ────────────────────────────────────────────────
  r('/about-us', '/about'),
  r('/contact-us', '/contact'),
  r('/terms', '/legal/terms'),
  r('/privacy', '/legal/privacy'),
  r('/vendor-terms', '/legal/vendor'),
  r('/dpa', '/legal/dpa'),
  r('/msa', '/legal/msa'),
  r('/cookie-policy', '/legal/cookies'),
  r('/refund-policy', '/legal/refunds'),
  r('/cancellation-policy', '/legal/cancellation'),
  r('/do-not-sell-my-info', '/legal/do-not-sell'),
  r('/return-policy', '/legal/terms'),
  r('/shipping-policy', '/legal/terms'),

  // ── Landing-page sections that used to have their own URLs ──────────────
  r('/talent-passport', '/#passport'),
  r('/assessment-framework', '/#assessments'),
  r('/assessments', '/#assessments'),
  r('/how-we-deliver', '/how-it-works'),
  r('/journeys', '/#journeys'),
  r('/three-journeys', '/#journeys'),

  // ── Audience aliases ────────────────────────────────────────────────────
  r('/hire', '/for-companies'),
  r('/hire/enterprise-landing', '/for-companies'),
  r('/employers', '/for-companies'),
  r('/companies', '/for-companies'),
  r('/institutions', '/for-companies'),
  r('/for-interviewers', '/for-experts'),
  r('/opportunities', '/jobs'),

  // ── Auth ────────────────────────────────────────────────────────────────
  r('/login', '/auth/login'),
  r('/register', '/auth/register'),
  r('/forgot-password', '/auth/forgot'),
  r('/reset-password', '/auth/reset'),
  r('/verify-otp', '/auth/verify-email'),
  // 2FA is a step of the sign-in page here, not a page of its own.
  r('/verify-2fa', '/auth/login'),
  r('/hire/login', '/auth/login'),
  r('/hire/register', register('Employer')),
  r('/hire/company-auth', register('Employer')),
  r('/hire/company/auth', register('Employer')),
  r('/company-auth', register('Employer')),
  r('/hire/candidate-auth', register('Candidate')),
  r('/hire/candidate/auth', register('Candidate')),
  r('/candidate-auth', register('Candidate')),
  r('/join', register('Candidate')),
  r('/talent', register('Candidate')),
  r('/candidates', register('Candidate')),

  // ── Job board (the /hire/jobs/new + editor paths before the :id patterns) ─
  r('/jobs/new', '/platform/requisitions'),
  r('/hire/jobs/new', '/platform/requisitions'),
  r('/hire/jobs', '/jobs'),
  r('/hire/jobs/:id/apply', '/jobs/:id'),
  r('/hire/jobs/:id/:rest+', '/platform/requisitions'),
  r('/hire/jobs/:id', '/jobs/:id'),
  r('/hire/pricing', '/pricing?audience=employer'),

  // ── Employer workspace ──────────────────────────────────────────────────
  r('/hire/workspace/:path*', '/platform/requisitions'),
  r('/hire/company/jobs', '/platform/requisitions'),
  r('/hire/company/applications', '/platform/pipeline'),
  r('/hire/talent-crm', '/platform/pools'),
  r('/hire/bulk-email', '/platform/outreach'),
  r('/hire/outreach', '/platform/outreach'),
  r('/hire/featured-experts', '/platform/experts'),

  // ── Candidate workspace ─────────────────────────────────────────────────
  r('/hire/candidate/dashboard', '/platform/applications'),
  r('/hire/candidate/applications', '/platform/applications'),
  r('/hire/my-applications', '/platform/applications'),
  r('/hire/applications/:path*', '/platform/applications'),
  r('/hire/candidate/profile', '/platform/profile'),
  r('/hire/mock-interview/:path*', '/platform/ai-interviews'),
  r('/hire/ai-interview-assessment/:path*', '/platform/ai-interviews'),
  r('/hire/frontline-interview', '/platform/ai-interviews'),
  r('/hire/interviews/:path*', '/platform/interviews'),
  r('/hire/assessments/:path*', '/platform/assess'),
  r('/hire/nt-assessments/:path*', '/platform/assess'),
  r('/hire/support', '/contact'),
  r('/interview', '/platform/ai-interviews'),

  // ── Marketplace workspace ───────────────────────────────────────────────
  r('/dashboard', '/platform'),
  r('/profile/:path*', '/platform/profile'),
  r('/projects/:path*', '/platform/projects'),
  r('/proposals', '/platform/proposals'),
  r('/orders/:id', '/platform/orders/:id'),
  r('/orders', '/platform/orders'),
  r('/expert/gig-orders', '/platform/orders'),
  r('/expert/services/:path*', '/platform/my-services'),
  r('/expert/certificates', '/platform/certificates'),
  r('/contracts/:id', '/platform/contracts/:id'),
  r('/contracts', '/platform/contracts'),
  r('/wallet', '/platform/wallet'),
  r('/messages', '/platform/messages'),
  r('/settings/:path*', '/platform/security'),
  r('/subscription/manage', '/platform/billing'),
  r('/support', '/contact'),
  r('/admin/:path*', '/platform/admin'),

  // ── Certificates (legacy /verify/:id; never the new /verify/certificate/:id) ─
  r('/verify/:id((?!certificate$)[^/]+)', '/verify/certificate/:id'),
  r('/certificate/:id', '/verify/certificate/:id'),
];

/** www → apex, so the canonical host in the sitemap is the one people land on. */
const HOST_REDIRECTS = [
  {
    source: '/:path*',
    has: [{ type: 'host', value: 'www.asteai.com' }],
    destination: 'https://asteai.com/:path*',
    permanent: true,
  },
];

module.exports = { LEGACY_REDIRECTS, HOST_REDIRECTS };
