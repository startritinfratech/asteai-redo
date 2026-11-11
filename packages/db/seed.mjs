import pg from 'pg';
import bcrypt from '../../apps/api/node_modules/bcryptjs/index.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read .env.local from api or root
let envText = '';
try {
  envText = readFileSync(resolve(process.cwd(), '../../apps/api/.env.local'), 'utf8');
} catch {
  try {
    envText = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  } catch {
    envText = readFileSync(resolve(process.cwd(), 'apps/api/.env.local'), 'utf8');
  }
}

const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

// The seed creates demo accounts with a published password (and an admin). Never against
// production unless someone explicitly asks for it on the command line.
const nodeEnv = process.env.NODE_ENV || env.NODE_ENV;
if (nodeEnv === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error(
    'Refusing to seed: NODE_ENV is "production". This script creates demo accounts (including an Admin) '
      + 'with a well-known password. If you really want that, run it again with ALLOW_DEMO_SEED=true.',
  );
  process.exit(1);
}

const client = new pg.Client({
  host: env.DATABASE_HOST,
  port: Number(env.DATABASE_PORT || 5432),
  database: env.DATABASE_NAME,
  user: env.DATABASE_USER,
  password: env.DATABASE_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log('Connected to RDS for seeding.');

const DEFAULT_PASSWORD = 'Password123!';
const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);

// 1. Tenants
const tenants = [
  { id: 'T-ASTEAI', name: 'AsteAI Operations', industry: 'Platform', plan: 'Enterprise', credits: 10000, seats: 50, domain: 'asteai.com', sso_enabled: true },
  { id: 'T-MERIDIAN', name: 'Meridian Hospitals', industry: 'Healthcare', plan: 'Enterprise', credits: 1840, seats: 25, domain: 'meridianhospitals.in', sso_enabled: true },
  { id: 'T-SWIFT', name: 'Swift Logistics', industry: 'Logistics', plan: 'Growth', credits: 420, seats: 8, domain: 'swiftlogistics.co.in', sso_enabled: false },
  { id: 'T-NOVA', name: 'NovaStack (buyer)', industry: 'SaaS / Product', plan: 'Marketplace', credits: 0, seats: 3, domain: 'novastack.io', sso_enabled: false },
];

for (const t of tenants) {
  await client.query(
    `INSERT INTO tenants (id, name, industry, plan, credits, seats, domain, sso_enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       industry = EXCLUDED.industry,
       plan = EXCLUDED.plan,
       credits = EXCLUDED.credits,
       seats = EXCLUDED.seats,
       domain = EXCLUDED.domain,
       sso_enabled = EXCLUDED.sso_enabled`,
    [t.id, t.name, t.industry, t.plan, t.credits, t.seats, t.domain, t.sso_enabled]
  );
}
console.log('Tenants seeded.');

// 2. Users
const users = [
  {
    id: '54aa8379-46f6-4158-9001-2340a9e6a13c',
    email: 'ops@asteai.com',
    firstName: 'Ops',
    lastName: 'Admin',
    role: 'Admin',
    tenantId: 'T-ASTEAI',
    title: 'AsteAI Platform Operations',
  },
  {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'priya@meridianhospitals.in',
    firstName: 'Priya',
    lastName: 'Menon',
    role: 'Employer',
    tenantId: 'T-MERIDIAN',
    title: 'HR / TA Admin',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    email: 'ravi@swiftlogistics.co.in',
    firstName: 'Ravi',
    lastName: 'Kulkarni',
    role: 'Employer',
    tenantId: 'T-SWIFT',
    title: 'Hub Operations Lead',
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    email: 'rahul.g@gmail.com',
    firstName: 'Rahul',
    lastName: 'Gowda',
    role: 'Candidate',
    tenantId: null,
    title: 'Nursing assistant · Mysuru',
    lang: 'Kannada',
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    email: 'aarav@dev.in',
    firstName: 'Aarav',
    lastName: 'Sharma',
    role: 'Freelancer',
    tenantId: null,
    title: 'Senior Distributed Systems Engineer',
    lang: 'English',
  },
  {
    id: '55555555-5555-5555-5555-555555555555',
    email: 'nikhil@novastack.io',
    firstName: 'Nikhil',
    lastName: 'Rao',
    role: 'Buyer',
    tenantId: 'T-NOVA',
    title: 'CTO, NovaStack',
  },
];

for (const u of users) {
  await client.query(
    `INSERT INTO user_accounts (id, email, email_canonical, first_name, last_name, role, tenant_id, title, password_hash, auth_provider, account_status, email_verified, preferred_language)
     VALUES ($1, $2::varchar, LOWER($2::varchar), $3, $4, $5, $6, $7, $8, 'local', 'active', true, $9)
     ON CONFLICT (email) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       role = EXCLUDED.role,
       tenant_id = EXCLUDED.tenant_id,
       title = EXCLUDED.title,
       password_hash = EXCLUDED.password_hash,
       email_canonical = LOWER(EXCLUDED.email),
       account_status = 'active',
       deleted_at = NULL,
       preferred_language = EXCLUDED.preferred_language`,
    [u.id, u.email, u.firstName, u.lastName, u.role, u.tenantId, u.title, passwordHash, u.lang || 'en']
  );
}
console.log('Users seeded with password:', DEFAULT_PASSWORD);

// 3. Requisitions
const reqs = [
  {
    id: 'REQ-7F2A',
    tenantId: 'T-MERIDIAN',
    ownerId: '11111111-1111-1111-1111-111111111111',
    title: 'Ward nursing assistants ×12',
    industry: 'Healthcare',
    func: 'Clinical & Care',
    echLevel: 1,
    tier: 'Frontline',
    weightIq: 25,
    weightEq: 45,
    weightGrit: 30,
    language: 'Kannada',
    location: 'Mysuru',
    headcount: 12,
    minShortlist: 5,
    threshold: 6.0,
    status: 'Open',
    slaFunded: true,
  },
  {
    id: 'REQ-3B19',
    tenantId: 'T-MERIDIAN',
    ownerId: '11111111-1111-1111-1111-111111111111',
    title: 'Finance analyst — hospital billing',
    industry: 'Healthcare',
    func: 'Finance',
    echLevel: 2,
    tier: 'Non-Technical',
    weightIq: 45,
    weightEq: 30,
    weightGrit: 25,
    language: 'English',
    location: 'Bengaluru',
    headcount: 1,
    minShortlist: 5,
    threshold: 6.5,
    status: 'Open',
    slaFunded: true,
  },
  {
    id: 'REQ-9C11',
    tenantId: 'T-SWIFT',
    ownerId: '22222222-2222-2222-2222-222222222222',
    title: 'Hub coordinators — Hubballi & Belagavi',
    industry: 'Logistics',
    func: 'Operations / Supply Chain',
    echLevel: 2,
    tier: 'Skilled',
    weightIq: 35,
    weightEq: 25,
    weightGrit: 40,
    language: 'Kannada',
    location: 'Hubballi',
    headcount: 4,
    minShortlist: 5,
    threshold: 6.0,
    status: 'Open',
    slaFunded: false,
  },
  {
    id: 'REQ-5D40',
    tenantId: 'T-SWIFT',
    ownerId: '22222222-2222-2222-2222-222222222222',
    title: 'Route planning analyst',
    industry: 'Logistics',
    func: 'Data & Analytics',
    echLevel: 3,
    tier: 'Technical',
    weightIq: 50,
    weightEq: 20,
    weightGrit: 30,
    language: 'English',
    location: 'Bengaluru',
    headcount: 1,
    minShortlist: 3,
    threshold: 7.0,
    status: 'Draft',
    slaFunded: false,
  },
];

for (const r of reqs) {
  await client.query(
    `INSERT INTO requisitions (id, tenant_id, owner_id, title, industry, func, ech_level, tier, weight_iq, weight_eq, weight_grit, language, location, headcount, min_shortlist, threshold, status, sla_funded)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       status = EXCLUDED.status,
       sla_funded = EXCLUDED.sla_funded`,
    [r.id, r.tenantId, r.ownerId, r.title, r.industry, r.func, r.echLevel, r.tier, r.weightIq, r.weightEq, r.weightGrit, r.language, r.location, r.headcount, r.minShortlist, r.threshold, r.status, r.slaFunded]
  );
}
console.log('Requisitions seeded.');

// 4. Candidate Applications
const apps = [
  {
    id: 'A-RAHUL-1',
    candidateId: '33333333-3333-3333-3333-333333333333',
    requisitionId: 'REQ-7F2A',
    tenantId: 'T-MERIDIAN',
    stage: 'Assessment Pending',
  },
];

for (const a of apps) {
  await client.query(
    `INSERT INTO applications (id, candidate_id, requisition_id, tenant_id, stage)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET stage = EXCLUDED.stage`,
    [a.id, a.candidateId, a.requisitionId, a.tenantId, a.stage]
  );
}
console.log('Applications seeded.');

// 5. Projects
const projects = [
  {
    id: 'PRJ-1041',
    buyerId: '55555555-5555-5555-5555-555555555555',
    tenantId: 'T-NOVA',
    title: 'Design a fault-tolerant event pipeline (Kafka → ClickHouse)',
    domain: 'Distributed systems',
    budget: 240000,
    stage: 'Open for Bids',
    description: 'Replace a batch ETL with an exactly-once streaming pipeline handling 40k events/s; deliver design doc, reference implementation and runbook.',
    milestones: JSON.stringify([
      { id: 'M1', name: 'Architecture and ADRs', amount: 60000, status: 'Pending' },
      { id: 'M2', name: 'Reference implementation with tests', amount: 120000, status: 'Pending' },
      { id: 'M3', name: 'Runbook, handover and load test', amount: 60000, status: 'Pending' },
    ]),
  },
  {
    id: 'PRJ-1037',
    buyerId: '55555555-5555-5555-5555-555555555555',
    tenantId: 'T-NOVA',
    title: 'LLM evaluation harness for support-bot regression',
    domain: 'AI / ML',
    budget: 90000,
    stage: 'In Progress',
    awardedTo: '44444444-4444-4444-4444-444444444444',
    description: 'Build an eval set of 400 labelled conversations and a nightly harness scoring hallucination, tone and resolution.',
    milestones: JSON.stringify([
      { id: 'M1', name: 'Eval set and rubric', amount: 30000, status: 'Released' },
      { id: 'M2', name: 'Harness and dashboard', amount: 45000, status: 'Funded' },
      { id: 'M3', name: 'Documentation', amount: 15000, status: 'Pending' },
    ]),
  },
];

for (const p of projects) {
  await client.query(
    `INSERT INTO projects (id, buyer_id, tenant_id, title, domain, budget, stage, description, milestones, awarded_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       stage = EXCLUDED.stage,
       milestones = EXCLUDED.milestones,
       awarded_to = EXCLUDED.awarded_to`,
    [p.id, p.buyerId, p.tenantId, p.title, p.domain, p.budget, p.stage, p.description, p.milestones, p.awardedTo || null]
  );
}
console.log('Projects seeded.');

// 6. Talent Passports
const passports = [
  {
    id: 'PASS-AARAV',
    userId: '44444444-4444-4444-4444-444444444444',
    name: 'Aarav Sharma',
    tier: 'Technical',
    scores: JSON.stringify([['Distributed Consensus', 98], ['Go / Rust Concurrency', 96], ['System Fault Tolerance', 94]]),
    stenIq: 8.9,
    stenEq: 7.4,
    stenGrit: 8.1,
    percentile: 98,
    status: 'Valid',
  },
];

for (const p of passports) {
  await client.query(
    `INSERT INTO passports (id, user_id, name, tier, scores, sten_iq, sten_eq, sten_grit, percentile, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
    [p.id, p.userId, p.name, p.tier, p.scores, p.stenIq, p.stenEq, p.stenGrit, p.percentile, p.status]
  );
}
console.log('Passports seeded.');

// 7. Certificates
const certs = [
  {
    id: 'CERT-RAHUL-1',
    userId: '33333333-3333-3333-3333-333333333333',
    name: 'Frontline Service Excellence — Level 1',
  },
  {
    id: 'CERT-AARAV-1',
    userId: '44444444-4444-4444-4444-444444444444',
    name: 'Distributed Systems — Senior track',
  },
];

for (const c of certs) {
  await client.query(
    `INSERT INTO certificates (id, user_id, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [c.id, c.userId, c.name]
  );
}
console.log('Certificates seeded.');

// 8. Assessment Results & Integrity Queue
const results = [
  {
    id: 'RES-FLAGGED-1',
    candidateId: '33333333-3333-3333-3333-333333333333',
    requisitionId: 'REQ-7F2A',
    stenIq: 7.2,
    stenEq: 6.8,
    stenGrit: 8.1,
    fitScore: 84.5,
    ciScore: 92.0,
    integrity: 'Review',
    integBlur: 3,
    integPaste: 1,
    integFast: 2,
    hash: 'a1b2c3d4e5f6g7h8',
  },
];

for (const r of results) {
  await client.query(
    `INSERT INTO assessment_results (id, candidate_id, requisition_id, sten_iq, sten_eq, sten_grit, fit_score, ci_score, integrity, integ_blur, integ_paste, integ_fast, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (id) DO UPDATE SET integrity = EXCLUDED.integrity`,
    [r.id, r.candidateId, r.requisitionId, r.stenIq, r.stenEq, r.stenGrit, r.fitScore, r.ciScore, r.integrity, r.integBlur, r.integPaste, r.integFast, r.hash]
  );

  await client.query(
    `INSERT INTO integrity_queue (id, result_id, reason, status)
     VALUES ($1, $2, $3, 'Open')
     ON CONFLICT (id) DO NOTHING`,
    ['IQ-101', r.id, `${r.integBlur} window blur events, ${r.integPaste} paste event during technical section`]
  );
}
console.log('Assessment results & Integrity Queue seeded.');

// 9. Talent Pools
const pools = [
  { id: 'POOL-1', tenantId: 'T-MERIDIAN', name: 'ICU & Critical Care Registered Nurses', count: 42, tags: ['Healthcare', 'ICU', 'BLS/ACLS'] },
  { id: 'POOL-2', tenantId: 'T-MERIDIAN', name: 'Clinical Lab Technicians', count: 18, tags: ['Diagnostics', 'Pathology'] },
  { id: 'POOL-3', tenantId: 'T-SWIFT', name: 'Hub Dispatch & Route Planners', count: 27, tags: ['Supply Chain', 'Fleet Operations'] },
];

for (const p of pools) {
  await client.query(
    `INSERT INTO talent_pools (id, tenant_id, name, count, tags)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, count = EXCLUDED.count, tags = EXCLUDED.tags`,
    [p.id, p.tenantId, p.name, p.count, p.tags]
  );
}
console.log('Talent pools seeded.');

// 10. Outreach Campaigns
const outreach = [
  { id: 'OUT-1', tenantId: 'T-MERIDIAN', name: 'Q4 Frontline Nursing Recruitment Drive', channel: 'WhatsApp & Email', sent: 150, opened: 112, applied: 38, status: 'Active' },
  { id: 'OUT-2', tenantId: 'T-SWIFT', name: 'Fleet Route Planners Bengaluru', channel: 'Email', sent: 80, opened: 54, applied: 14, status: 'Active' },
];

for (const o of outreach) {
  await client.query(
    `INSERT INTO outreach_campaigns (id, tenant_id, name, channel, sent, opened, applied, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sent = EXCLUDED.sent, opened = EXCLUDED.opened, applied = EXCLUDED.applied, status = EXCLUDED.status`,
    [o.id, o.tenantId, o.name, o.channel, o.sent, o.opened, o.applied, o.status]
  );
}
console.log('Outreach campaigns seeded.');

// 11. Ledger Entries
const ledger = [
  { id: 'TX-1', tenantId: 'T-MERIDIAN', userId: '54aa8379-46f6-4158-9001-2340a9e6a13c', type: 'Credit purchase', description: 'Purchased 2,000 hiring assessment credits', amount: 2000, fee: 0, by: 'Stripe Corporate' },
  { id: 'TX-2', tenantId: 'T-MERIDIAN', userId: '11111111-1111-1111-1111-111111111111', type: 'Assessment deduction', description: 'Role-fit battery for REQ-7F2A', amount: -160, fee: 0, by: 'AsteAI Engine' },
  { id: 'TX-3', tenantId: 'T-NOVA', userId: '55555555-5555-5555-5555-555555555555', type: 'Escrow hold', description: 'Milestone M1 funded: Architecture and ADRs', amount: -60000, fee: 1800, by: 'NovaStack Escrow' },
  { id: 'TX-4', tenantId: null, userId: '44444444-4444-4444-4444-444444444444', type: 'Escrow release', description: 'Milestone M1 payout: Architecture and ADRs', amount: 60000, fee: 3000, by: 'NovaStack Escrow' },
];

for (const l of ledger) {
  await client.query(
    `INSERT INTO ledger_entries (id, tenant_id, user_id, type, description, amount, fee, by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [l.id, l.tenantId, l.userId, l.type, l.description, l.amount, l.fee, l.by]
  );
}
console.log('Ledger entries seeded.');

// 12. Disputes
const disputes = [
  {
    id: 'DISP-1',
    projectId: 'PRJ-1037',
    raisedBy: '55555555-5555-5555-5555-555555555555',
    raisedAgainst: '44444444-4444-4444-4444-444444444444',
    reason: 'Scope clarification on nightly automated benchmark suite',
    status: 'In Review',
    timeline: JSON.stringify([
      { date: '2026-11-01', note: 'Dispute initiated by Buyer regarding test harness metrics' },
      { date: '2026-11-02', note: 'Freelancer submitted architecture specification update' },
    ]),
  },
];

for (const d of disputes) {
  await client.query(
    `INSERT INTO disputes (id, project_id, raised_by, raised_against, reason, status, timeline)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [d.id, d.projectId, d.raisedBy, d.raisedAgainst, d.reason, d.status, d.timeline]
  );
}
console.log('Disputes seeded.');

// 13. User Consents
const consents = [
  { userId: '33333333-3333-3333-3333-333333333333', purpose: 'AI Proctoring & Biometric Integrity', status: 'Active' },
  { userId: '33333333-3333-3333-3333-333333333333', purpose: 'Public Talent Passport Credential Verification', status: 'Active' },
  { userId: '33333333-3333-3333-3333-333333333333', purpose: 'Voice AI Audio Processing & Synthesis', status: 'Active' },
  { userId: '44444444-4444-4444-4444-444444444444', purpose: 'Public Talent Passport Credential Verification', status: 'Active' },
  { userId: '44444444-4444-4444-4444-444444444444', purpose: 'AI Proctoring & Biometric Integrity', status: 'Active' },
];

for (const c of consents) {
  await client.query(
    `INSERT INTO consents (user_id, purpose, status)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [c.userId, c.purpose, c.status]
  );
}
console.log('Consents seeded.');

// 14. Audit Log
const logs = [
  { actorId: '54aa8379-46f6-4158-9001-2340a9e6a13c', actorName: 'Ops Admin', role: 'Admin', action: 'Tenant Plan Upgrade', entity: 'T-MERIDIAN', meta: 'Upgraded to Enterprise plan (50 seats)' },
  { actorId: '54aa8379-46f6-4158-9001-2340a9e6a13c', actorName: 'Ops Admin', role: 'Admin', action: 'SSO Policy Enforced', entity: 'T-MERIDIAN', meta: 'SAML 2.0 SSO enabled with meridianhospitals.in' },
  { actorId: '11111111-1111-1111-1111-111111111111', actorName: 'Priya Menon', role: 'Employer', action: 'Create Requisition', entity: 'REQ-7F2A', meta: 'Staff Nurse — ICU & Critical Care published' },
];

for (const l of logs) {
  await client.query(
    `INSERT INTO audit_log (actor_id, actor_name, role, action, entity, meta)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [l.actorId, l.actorName, l.role, l.action, l.entity, l.meta]
  );
}
console.log('Audit log seeded.');

await client.end();
console.log('\nSeeding completed successfully!');
