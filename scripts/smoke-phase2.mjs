#!/usr/bin/env node
/**
 * End-to-end smoke test of the Phase 2 public / marketing / OTP / jobs / products / support
 * endpoints against a running API and its database. It writes test rows (users, a tenant,
 * requisitions, a product, tickets), so point it at a throwaway database only, and expect an
 * EMPTY job board and product catalogue (some checks count rows).
 *
 *   SMOKE_API_URL=http://127.0.0.1:3001 SMOKE_DATABASE_URL=postgres://... node scripts/smoke-phase2.mjs
 *
 * Run the API with EMAIL_TRANSPORT=log and without TURNSTILE_SECRET_KEY.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(fileURLToPath(new URL('../packages/db/package.json', import.meta.url)));
const pg = require('pg');

if (!process.env.SMOKE_DATABASE_URL) {
  console.error('SMOKE_DATABASE_URL is not set (use a throwaway database: this script writes test data).');
  process.exit(1);
}
const BASE = `${(process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '')}/api/v1`;
const db = new pg.Client({ connectionString: process.env.SMOKE_DATABASE_URL });
await db.connect();

const results = [];
let failures = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, cond, detail = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -- ${detail}`}`);
  if (!cond) failures++;
}
async function call(method, path, body, token, headers = {}) {
  await sleep(250); // stay under the global 50 req / 10 s limit
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json?.data ?? json, raw: json, headers: res.headers };
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const lastMail = (to, template) => one(
  `SELECT subject, text, html FROM email_outbox WHERE to_address = $1 AND template = $2 ORDER BY created_at DESC LIMIT 1`, [to, template]);
const run = Date.now().toString(36);

// ── Public reads ────────────────────────────────────────────────────────────
let r = await call('GET', '/plans?audience=employer');
check('GET /plans?audience=employer → 3 employer plans', r.status === 200 && r.body.length === 3 && r.body.every((p) => p.audience === 'employer'), JSON.stringify(r.raw).slice(0, 200));
check('plans: contact-sales price is null', r.body?.some((p) => p.priceMinor === null));
r = await call('GET', '/plans');
check('GET /plans → 6 plans, Pro is ₹499 (49900 paise)', r.body?.length === 6 && r.body.find((p) => p.id === 'pro')?.priceMinor === 49900);
r = await call('GET', '/public-settings/credits');
check('GET /public-settings/credits shape', r.status === 200 && r.body.welcomeBonusCredits === 5 && r.body.costs.length === 11
  && JSON.stringify(r.body.proposalBudgetTiers) === '[5000,25000,100000]', JSON.stringify(r.body).slice(0, 200));
check('credits: Cache-Control set', /max-age=60/.test(r.headers.get('cache-control') ?? ''));
r = await call('GET', '/public/stats');
check('GET /public/stats', r.status === 200 && typeof r.body.openJobs === 'number', JSON.stringify(r.raw));
r = await call('GET', '/geo', undefined, null, { 'CloudFront-Viewer-Country': 'IN' });
check('GET /geo reads CDN header', r.body?.country === 'IN', JSON.stringify(r.raw));
r = await call('GET', '/careers/roles');
check('GET /careers/roles → 3 seeded roles', r.body?.length === 3);
r = await call('GET', '/support/categories');
check('GET /support/categories → 6', r.body?.length === 6);
r = await call('GET', '/products');
check('GET /products (empty catalogue)', r.status === 200 && r.body.total === 0 && Array.isArray(r.body.items), JSON.stringify(r.raw));
r = await call('GET', '/jobs/public');
check('GET /jobs/public (empty board)', r.status === 200 && r.body.total === 0 && r.body.nextCursor === null, JSON.stringify(r.raw));
r = await call('GET', '/jobs/public?limit=500');
check('GET /jobs/public?limit=500 → 400', r.status === 400);

// ── Forms ───────────────────────────────────────────────────────────────────
const leadEmail = `lead-${run}@example.com`;
const lead = { track: 'technical', roleTitle: 'ML Engineer', skills: 'PyTorch', workMode: 'remote', timeline: 'immediate',
  company: 'Acme', contactName: 'Jane Smith', email: leadEmail, phone: '+91 98765 43210' };
r = await call('POST', '/leads', lead);
check('POST /leads → 201 received', r.status === 201 && r.body?.received === true, JSON.stringify(r.raw));
const leadRow = await one(`SELECT phone, ip, status FROM leads WHERE email = $1`, [leadEmail]);
check('lead stored with normalised phone + IP', leadRow?.phone === '+919876543210' && leadRow.ip && leadRow.status === 'new', JSON.stringify(leadRow));
check('lead → internal + ack emails queued', Boolean(await lastMail('supportasteai@startrit.com', 'lead-received')) && Boolean(await lastMail(leadEmail, 'lead-ack')));
r = await call('POST', '/leads', { ...lead, email: `hp-${run}@example.com`, website: 'http://spam' });
check('honeypot lead → 201 but nothing stored', r.status === 201 && !(await one(`SELECT 1 FROM leads WHERE email = $1`, [`hp-${run}@example.com`])));
r = await call('POST', '/leads', { ...lead, email: `x-${run}@mailinator.com` });
check('disposable email → 400', r.status === 400, JSON.stringify(r.raw));
r = await call('POST', '/leads', { ...lead, track: 'nope', phone: '123' });
check('invalid lead → 400', r.status === 400);
r = await call('POST', '/leads', { ...lead, email: `fifth-${run}@example.com` });
check('5th lead post in a minute is still accepted', r.status === 201, `status ${r.status}`);
r = await call('POST', '/leads', lead);
check('5/min form limit → 429 on the 6th lead post', r.status === 429, `status ${r.status}`);

const contactEmail = `contact-${run}@example.com`;
r = await call('POST', '/contact', { name: 'Jane', email: contactEmail, subject: 'Book a demo\r\nBcc: x@y.com', message: 'We have 40 roles to fill.', intent: 'demo' });
check('POST /contact (demo) → 201', r.status === 201, JSON.stringify(r.raw));
const contactMail = await lastMail('supportasteai@startrit.com', 'contact-received');
check('contact notice subject has no CR/LF', contactMail && !/[\r\n]/.test(contactMail.subject), contactMail?.subject);

const subEmail = `news-${run}@example.com`;
r = await call('POST', '/newsletter/subscribe', { email: subEmail, source: 'footer' });
check('newsletter subscribe → pending', r.body?.status === 'pending', JSON.stringify(r.raw));
const confirmMail = await lastMail(subEmail, 'newsletter-confirm');
const confirmToken = confirmMail?.text.match(/newsletter\/confirm\?token=([\w-]+)/)?.[1];
const unsubToken = confirmMail?.text.match(/unsubscribe\?token=([\w-]+)/)?.[1];
check('confirm email carries both tokens', Boolean(confirmToken && unsubToken), confirmMail?.text);
r = await call('POST', '/newsletter/confirm', { token: confirmToken });
check('newsletter confirm → subscribed', r.body?.status === 'subscribed', JSON.stringify(r.raw));
r = await call('POST', '/newsletter/confirm', { token: confirmToken });
check('confirm token is single-use → 400', r.status === 400);
const before = (await one(`SELECT COUNT(*)::int n FROM email_outbox WHERE to_address = $1`, [subEmail])).n;
r = await call('POST', '/newsletter/subscribe', { email: subEmail });
const after = (await one(`SELECT COUNT(*)::int n FROM email_outbox WHERE to_address = $1`, [subEmail])).n;
check('re-subscribe of subscribed address → pending, no email', r.body?.status === 'pending' && before === after);
r = await call('POST', '/newsletter/unsubscribe', { token: unsubToken });
check('unsubscribe → unsubscribed', r.body?.status === 'unsubscribed', JSON.stringify(r.raw));

const roles = (await call('GET', '/careers/roles')).body;
r = await call('POST', '/careers/applications', { roleSlug: roles[0].slug, fullName: 'Ravi Kumar', email: `cv-${run}@example.com`, profileUrl: 'https://github.com/ravi' });
check('careers application → 201', r.status === 201, JSON.stringify(r.raw));
r = await call('POST', '/careers/applications', { roleSlug: 'no-such-role', fullName: 'Ravi Kumar', email: `cv2-${run}@example.com` });
check('application to unknown role → 404', r.status === 404);

// ── Sign-up with an email code ──────────────────────────────────────────────
const candEmail = `cand-${run}@example.com`;
r = await call('POST', '/auth/email/send-otp', { email: candEmail });
check('send-otp → sent', r.status === 200 && r.body?.sent === true, JSON.stringify(r.raw));
const code = (await lastMail(candEmail, 'signup-otp'))?.subject.match(/^(\d{6})/)?.[1];
check('code emailed (6 digits)', Boolean(code));
const stored = await one(`SELECT code_hash FROM email_otps WHERE email = $1`, [candEmail]);
check('code not stored in plain text', stored && stored.code_hash !== code && stored.code_hash.length === 64);
r = await call('POST', '/auth/email/send-otp', { email: candEmail });
check('resend within 60 s → 429', r.status === 429, `status ${r.status}`);
r = await call('POST', '/auth/email/verify-otp', { email: candEmail, code: code === '000000' ? '111111' : '000000' });
check('wrong code → 400 and attempt counted', r.status === 400 && (await one(`SELECT attempts FROM email_otps WHERE email = $1`, [candEmail])).attempts === 1);
r = await call('POST', '/auth/email/verify-otp', { email: candEmail, code });
const ticket = r.body?.otpTicket;
check('correct code → otpTicket', r.status === 200 && Boolean(ticket), JSON.stringify(r.raw));
r = await call('GET', '/support/tickets', undefined, ticket);
check('otpTicket is not accepted as a login token → 401', r.status === 401);
r = await call('POST', '/auth/register', { email: candEmail, firstName: 'Cara', lastName: 'Ndid', password: 'Str0ng!Passw0rd', role: 'Candidate', otpTicket: ticket });
check('register with ticket → 201', r.status === 201 && Boolean(r.body?.accessToken), JSON.stringify(r.raw).slice(0, 200));
const candToken = r.body?.accessToken;
check('account starts verified, no verify-email sent',
  (await one(`SELECT email_verified FROM user_accounts WHERE email = $1`, [candEmail]))?.email_verified === true
  && !(await lastMail(candEmail, 'verify-email')));
r = await call('POST', '/auth/register', { email: `other-${run}@example.com`, firstName: 'Eve', lastName: 'X', password: 'Str0ng!Passw0rd', otpTicket: ticket });
check('ticket for another address → 400', r.status === 400);
r = await call('POST', '/auth/email/send-otp', { email: `cand-${run}@EXAMPLE.com` });
await sleep(100);
check('send-otp for a registered address: same answer, "account exists" email, no code',
  r.status === 429 || (r.status === 200 && Boolean(await lastMail(candEmail, 'signup-account-exists'))), `status ${r.status}`);

// ── Job board end to end ────────────────────────────────────────────────────
await db.query(`INSERT INTO tenants (id, name, industry, website) VALUES ($1, 'Acme Robotics', 'Robotics', 'https://acme.example') ON CONFLICT DO NOTHING`, [`T-${run}`]);
const empEmail = `emp-${run}@example.com`;
r = await call('POST', '/auth/register', { email: empEmail, firstName: 'Emma', lastName: 'Ployer', password: 'Str0ng!Passw0rd', role: 'Employer' });
check('legacy register (no ticket) still works', r.status === 201, JSON.stringify(r.raw).slice(0, 200));
await db.query(`UPDATE user_accounts SET tenant_id = $1 WHERE email = $2`, [`T-${run}`, empEmail]);
r = await call('POST', '/auth/login', { email: empEmail, password: 'Str0ng!Passw0rd' });
const empToken = r.body?.accessToken;
r = await call('POST', '/requisitions', {
  title: 'Robotics Firmware Engineer', industry: 'Robotics', func: 'Engineering', echLevel: 3, tier: 'Technical',
  weights: { iq: 40, eq: 30, grit: 30 }, lang: 'English', location: 'Bengaluru', headcount: 2, brief: 'Motor control firmware.',
}, empToken);
const reqId = r.body?.id;
check('employer creates requisition', r.status === 201 && Boolean(reqId), JSON.stringify(r.raw).slice(0, 300));
r = await call('PUT', `/requisitions/${reqId}`, { status: 'Open' }, empToken);
check('requisition → Open', r.body?.status === 'Open', JSON.stringify(r.raw).slice(0, 300));
r = await call('PATCH', `/requisitions/${reqId}/posting`, { salaryMin: 3000000, salaryMax: 1000000 }, empToken);
check('posting: min > max → 400', r.status === 400);
r = await call('PATCH', `/requisitions/${reqId}/posting`, {
  isPublic: true, employmentType: 'full_time', locationType: 'hybrid', salaryMin: 1800000, salaryMax: 3000000,
  requirements: ['C/C++', ' RTOS ', ''],
}, empToken);
check('posting: publish → posting.isPublic + publishedAt', r.status === 200 && r.body?.posting?.isPublic === true && Boolean(r.body.posting.publishedAt)
  && JSON.stringify(r.body.posting.requirements) === '["C/C++","RTOS"]', JSON.stringify(r.raw).slice(0, 400));
r = await call('GET', '/jobs/public?q=firmware&locationType=hybrid');
const job = r.body?.items?.[0];
check('job appears on the board with company + salary as numbers', r.body?.total === 1 && job?.id === reqId && job.company.name === 'Acme Robotics'
  && job.salaryMin === 1800000 && job.locationType === 'hybrid', JSON.stringify(r.raw).slice(0, 400));
r = await call('GET', `/jobs/public/${reqId}`);
check('GET /jobs/public/:id', r.status === 200 && r.body.description === 'Motor control firmware.');
r = await call('GET', '/jobs/public?locationType=remote');
check('filter excludes it (remote)', r.body?.total === 0);
r = await call('GET', '/public/stats');
check('stats counts the open job', r.body?.openJobs === 1, JSON.stringify(r.raw));
await db.query(`UPDATE tenants SET is_test = TRUE WHERE id = $1`, [`T-${run}`]);
r = await call('GET', `/jobs/public/${reqId}`);
check('test tenant hides the job (404)', r.status === 404);
await db.query(`UPDATE tenants SET is_test = FALSE WHERE id = $1`, [`T-${run}`]);
r = await call('PATCH', `/requisitions/${reqId}/posting`, { isPublic: false }, empToken);
r = await call('GET', `/jobs/public/${reqId}`);
check('unpublished job → 404', r.status === 404);

// Keyset pagination: 3 public jobs, page size 2
await call('PATCH', `/requisitions/${reqId}/posting`, { isPublic: true }, empToken);
for (const t of ['Controls Engineer', 'Perception Engineer']) {
  const c = await call('POST', '/requisitions', { title: t, industry: 'Robotics', func: 'Engineering', echLevel: 3, tier: 'Technical',
    weights: { iq: 40, eq: 30, grit: 30 }, lang: 'English', headcount: 1 }, empToken);
  await call('PUT', `/requisitions/${c.body.id}`, { status: 'Open' }, empToken);
  await call('PATCH', `/requisitions/${c.body.id}/posting`, { isPublic: true }, empToken);
}
const p1 = await call('GET', '/jobs/public?limit=2');
const p2 = await call('GET', `/jobs/public?limit=2&cursor=${p1.body?.nextCursor}`);
const ids = [...(p1.body?.items ?? []), ...(p2.body?.items ?? [])].map((j) => j.id);
check('cursor pagination: 2 + 1, no duplicates, last page has no cursor',
  p1.body?.items.length === 2 && p2.body?.items.length === 1 && new Set(ids).size === 3 && p2.body.nextCursor === null && p1.body.total === 3,
  JSON.stringify({ p1: p1.body, p2: p2.body }).slice(0, 400));

// ── Products ────────────────────────────────────────────────────────────────
const sellerEmail = `seller-${run}@example.com`;
r = await call('POST', '/auth/register', { email: sellerEmail, firstName: 'Aarav', lastName: 'Sharma', password: 'Str0ng!Passw0rd', role: 'Freelancer' });
const sellerToken = r.body?.accessToken;
const sellerId = r.body?.user?.id;
const productBody = { title: 'Next.js Enterprise Boilerplate', summary: 'Production-ready Next.js starter with auth and RBAC.',
  description: 'Includes SSO, role-based access control, audit logging, CI pipelines and infrastructure as code for AWS deployments.',
  category: 'Codebases', tags: ['nextjs', 'NextJS', 'saas'], priceMinor: 499900, license: 'single_team' };
r = await call('POST', '/products', productBody, sellerToken);
const prodId = r.body?.id;
check('seller creates draft product (tags de-duplicated)', r.status === 201 && r.body.status === 'draft' && r.body.tags.length === 2, JSON.stringify(r.raw).slice(0, 300));
r = await call('POST', `/products/${prodId}/submit`, undefined, sellerToken);
check('submit without approved expert profile → 403', r.status === 403);
await db.query(`INSERT INTO expert_profiles (user_id, status) VALUES ($1, 'approved')`, [sellerId]);
r = await call('POST', `/products/${prodId}/submit`, undefined, sellerToken);
check('submit → pending', r.body?.status === 'pending', JSON.stringify(r.raw));
r = await call('PUT', `/products/${prodId}`, productBody, sellerToken);
check('edit while pending → 409', r.status === 409);
r = await call('POST', '/products', productBody, candToken);
check('candidate cannot create products → 403', r.status === 403);

const adminEmail = `admin-${run}@example.com`;
await call('POST', '/auth/register', { email: adminEmail, firstName: 'Ada', lastName: 'Min', password: 'Str0ng!Passw0rd' });
await db.query(`UPDATE user_accounts SET role = 'Admin' WHERE email = $1`, [adminEmail]);
const adminToken = (await call('POST', '/auth/login', { email: adminEmail, password: 'Str0ng!Passw0rd' })).body?.accessToken;
r = await call('GET', '/admin/products', undefined, adminToken);
check('admin sees the pending product', r.body?.some?.((p) => p.id === prodId), JSON.stringify(r.raw).slice(0, 200));
r = await call('PATCH', `/admin/products/${prodId}/status`, { status: 'rejected' }, adminToken);
check('reject without note → 400', r.status === 400);
r = await call('PATCH', `/admin/products/${prodId}/status`, { status: 'active' }, adminToken);
check('admin approves → active', r.body?.status === 'active', JSON.stringify(r.raw));
r = await call('GET', '/products?q=boilerplate');
const card = r.body?.items?.[0];
check('public catalogue shows it with "Aarav S." and no file key', r.body?.total === 1 && card?.sellerName === 'Aarav S.' && !('fileKey' in card) && !('hasFile' in card),
  JSON.stringify(r.raw).slice(0, 300));
r = await call('GET', `/products/${card?.slug}`);
check('GET /products/:slug', r.status === 200 && r.body.description.startsWith('Includes SSO'));
r = await call('GET', '/products/no-such-slug');
check('unknown slug → 404', r.status === 404);
r = await call('GET', '/products', undefined, null);
check('seller notified on approval', Boolean(await one(`SELECT 1 FROM notifications WHERE user_id = $1 AND text LIKE '%is live%'`, [sellerId]).catch(() => null))
  || Boolean(await one(`SELECT 1 FROM notifications WHERE user_id = $1`, [sellerId])));

// ── Support ─────────────────────────────────────────────────────────────────
r = await call('POST', '/support/tickets', { categoryId: 'account', subject: 'Cannot upload resume', body: 'The upload button does nothing.' }, candToken);
const ticketId = r.body?.id;
check('user opens ticket', r.status === 201 && r.body.messages.length === 1 && r.body.status === 'open', JSON.stringify(r.raw).slice(0, 300));
r = await call('GET', `/support/tickets/${ticketId}`, undefined, sellerToken);
check("another user can't read it → 404", r.status === 404);
r = await call('POST', `/admin/support/tickets/${ticketId}/messages`, { body: 'Please try a PDF under 5 MB.' }, adminToken);
check('staff reply → pending_user, shown as ASTEAI Support', r.body?.status === 'pending_user' && r.body.messages[1].authorName === 'ASTEAI Support', JSON.stringify(r.raw).slice(0, 300));
check('user emailed about the reply', Boolean(await lastMail(candEmail, 'support-reply')));
r = await call('POST', `/support/tickets/${ticketId}/messages`, { body: 'That worked, thanks!' }, candToken);
check('user reply reopens', r.body?.status === 'open');
r = await call('POST', `/support/tickets/${ticketId}/resolve`, undefined, candToken);
check('user resolves', r.body?.status === 'resolved');
r = await call('POST', '/support/tickets', { categoryId: 'nope', subject: 'Hello there', body: 'Something else entirely.' }, candToken);
check('unknown category → 400', r.status === 400);

// ── Admin leads ─────────────────────────────────────────────────────────────
r = await call('GET', '/admin/leads?status=new', undefined, adminToken);
const leadId = r.body?.items?.find((l) => l.email === leadEmail)?.id;
check('admin lists new leads', Boolean(leadId), JSON.stringify(r.raw).slice(0, 200));
r = await call('PATCH', `/admin/leads/${leadId}`, { status: 'contacted' }, adminToken);
check('admin moves lead → contacted (owner set)', r.body?.status === 'contacted'
  && Boolean((await one(`SELECT owner_id FROM leads WHERE id = $1`, [leadId]))?.owner_id));
r = await call('GET', '/admin/leads', undefined, candToken);
check('non-admin → 403', r.status === 403);

console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} passed`);
await db.end();
process.exit(failures ? 1 : 0);
