-- Pricing and platform settings served to public pages (one source for /pricing and the
-- employer pricing tab), plus the credit cost of each metered AI feature.
--
-- plans: price_minor is in the currency's minor unit (paise); NULL means "contact sales".
-- monthly_credits are granted per billing period. features is an ordered list of bullets.
-- credit_costs: read by the pricing page and, from Phase 3, by the code that deducts
-- credits, so the advertised and the charged cost cannot disagree.
-- platform_settings: small key → JSON values (bonuses, proposal budget tiers).

CREATE TABLE IF NOT EXISTS plans (
  id                VARCHAR(40)   PRIMARY KEY,
  audience          VARCHAR(12)   NOT NULL CHECK (audience IN ('individual', 'employer')),
  name              VARCHAR(40)   NOT NULL,
  tagline           TEXT          NOT NULL DEFAULT '',
  price_minor       INTEGER       CHECK (price_minor IS NULL OR price_minor >= 0),
  currency          CHAR(3)       NOT NULL DEFAULT 'INR',
  interval          VARCHAR(8)    NOT NULL DEFAULT 'month' CHECK (interval IN ('month', 'year')),
  monthly_credits   INTEGER       NOT NULL DEFAULT 0 CHECK (monthly_credits >= 0),
  features          JSONB         NOT NULL DEFAULT '[]',
  highlighted       BOOLEAN       NOT NULL DEFAULT FALSE,
  razorpay_plan_id  TEXT,
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  sort              SMALLINT      NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS credit_costs (
  feature   VARCHAR(40)  PRIMARY KEY,
  label     TEXT         NOT NULL,
  cost      SMALLINT     NOT NULL CHECK (cost >= 0),
  -- A range such as proposals (3–12, by budget tier) shows cost..cost_max.
  cost_max  SMALLINT     CHECK (cost_max IS NULL OR cost_max >= cost),
  sort      SMALLINT     NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key         VARCHAR(60)  PRIMARY KEY,
  value       JSONB        NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO plans (id, audience, name, tagline, price_minor, monthly_credits, features, highlighted, sort) VALUES
  -- Individual plans: copy and prices as published on the production pricing page.
  ('free', 'individual', 'Free', 'Perfect for getting started', 0, 0,
   '["Browse Projects & Experts","Messaging & Reviews","Natural language search","Basic Profile"]', FALSE, 1),
  ('pro', 'individual', 'Pro', 'For professionals and growing teams', 49900, 100,
   '["Everything in Free","AI Expert Search","Voice Search","AI Resume Autofill","AI Gig Creation","Priority Proposal Ranking"]', TRUE, 2),
  ('enterprise', 'individual', 'Enterprise', 'For large organizations', 149900, 300,
   '["Everything in Pro","AI Project Creation","Proposal Analytics","Featured Placement","AI Dispute Management","Dedicated Support"]', FALSE, 3),
  -- Employer plans: placeholder copy, priced as "contact sales" until the employer price list is confirmed.
  ('employer-free', 'employer', 'Free', 'Try ASTEAI hiring', 0, 0,
   '["1 active requisition","AI job creator","Applications pipeline"]', FALSE, 1),
  ('employer-pro', 'employer', 'Pro', 'For growing hiring teams', NULL, 0,
   '["Unlimited requisitions","AI interviews and assessments","Talent CRM pools"]', TRUE, 2),
  ('employer-enterprise', 'employer', 'Enterprise', 'Custom rollout and SLAs', NULL, 0,
   '["SSO and audit log","Custom workflows","Dedicated manager and SLAs"]', FALSE, 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO credit_costs (feature, label, cost, cost_max, sort) VALUES
  ('expert_autofill',     'Expert profile autofill',      15, NULL, 1),
  ('ai_expert_chat',      'Chat with AI to find experts', 15, NULL, 2),
  ('ai_search',           'AI search',                    15, NULL, 3),
  ('voice_search',        'Voice search',                  3, NULL, 4),
  ('ai_create_gig',       'Create a gig with AI',         15, NULL, 5),
  ('ai_create_project',   'Create a project with AI',     15, NULL, 6),
  ('semantic_gig_search', 'Semantic search of gigs',       6, NULL, 7),
  ('project_recs',        'Project recommendations',       6, NULL, 8),
  ('proposal',            'Sending a proposal',            3,   12, 9),
  ('quick_connect',       'Quick expert connect',          1, NULL, 10),
  ('dispute',             'Opening a dispute',             3, NULL, 11)
ON CONFLICT (feature) DO NOTHING;

INSERT INTO platform_settings (key, value) VALUES
  ('welcome_bonus_credits',  '5'),
  ('referral_bonus_credits', '10'),
  ('max_referrals_per_user', '3'),
  ('proposal_budget_tiers',  '[5000, 25000, 100000]')
ON CONFLICT (key) DO NOTHING;
