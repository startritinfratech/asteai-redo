-- Public marketing forms: sales leads ("Submit a requirement"), contact / demo requests,
-- the newsletter, and careers (open roles + applications).
--
-- Every form row keeps the submitter's IP (rate-limit forensics, abuse review) and is
-- written in the same transaction as its notification emails (email_outbox).
--
-- newsletter_subscribers: double opt-in. A row starts 'pending' with the SHA-256 of a
-- confirm token; confirming sets 'subscribed'. unsubscribe_token_hash backs the one-click
-- link in every newsletter email. Re-subscribing an unsubscribed address goes back to
-- 'pending' (a fresh confirmation), never straight to 'subscribed'.

CREATE TABLE IF NOT EXISTS leads (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  track         VARCHAR(16)   NOT NULL CHECK (track IN ('technical', 'professional', 'frontline')),
  role_title    VARCHAR(120)  NOT NULL,
  skills        TEXT          CHECK (char_length(skills) <= 2000),
  work_mode     VARCHAR(8)    NOT NULL CHECK (work_mode IN ('remote', 'hybrid', 'onsite')),
  timeline      VARCHAR(12)   NOT NULL CHECK (timeline IN ('immediate', '2weeks', 'flexible')),
  company       VARCHAR(160)  NOT NULL,
  contact_name  VARCHAR(120)  NOT NULL,
  email         VARCHAR(254)  NOT NULL,
  phone         VARCHAR(20)   NOT NULL,
  utm           JSONB         NOT NULL DEFAULT '{}',
  status        VARCHAR(12)   NOT NULL DEFAULT 'new'
                              CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost')),
  owner_id      UUID          REFERENCES user_accounts(id) ON DELETE SET NULL,
  ip            INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leads_status_created ON leads(status, created_at DESC);

CREATE TABLE IF NOT EXISTS contact_messages (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(120)  NOT NULL,
  email       VARCHAR(254)  NOT NULL,
  subject     VARCHAR(200)  NOT NULL,
  message     TEXT          NOT NULL CHECK (char_length(message) <= 5000),
  intent      VARCHAR(8)    NOT NULL DEFAULT 'contact' CHECK (intent IN ('contact', 'demo')),
  status      VARCHAR(8)    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  ip          INET,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_status_created ON contact_messages(status, created_at DESC);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id                      UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  email                   VARCHAR(254)  NOT NULL,
  email_canonical         VARCHAR(254)  NOT NULL UNIQUE,
  status                  VARCHAR(14)   NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending', 'subscribed', 'unsubscribed')),
  source                  VARCHAR(40),
  confirm_token_hash      TEXT          UNIQUE,
  confirm_expires_at      TIMESTAMPTZ,
  unsubscribe_token_hash  TEXT          NOT NULL UNIQUE,
  confirmed_at            TIMESTAMPTZ,
  unsubscribed_at         TIMESTAMPTZ,
  ip                      INET,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS career_roles (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug         VARCHAR(80)   NOT NULL UNIQUE,
  title        VARCHAR(120)  NOT NULL,
  team         VARCHAR(60),
  location     VARCHAR(80)   NOT NULL DEFAULT 'Remote',
  type         VARCHAR(20)   NOT NULL DEFAULT 'full_time',
  skills       TEXT          NOT NULL DEFAULT '',
  description  TEXT          NOT NULL DEFAULT '',
  is_open      BOOLEAN       NOT NULL DEFAULT TRUE,
  sort         SMALLINT      NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS career_applications (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id      UUID          NOT NULL REFERENCES career_roles(id) ON DELETE RESTRICT,
  full_name    VARCHAR(120)  NOT NULL,
  email        VARCHAR(254)  NOT NULL,
  profile_url  VARCHAR(300),
  message      TEXT          CHECK (char_length(message) <= 3000),
  resume_key   TEXT,
  ip           INET,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_career_applications_role ON career_applications(role_id, created_at DESC);

INSERT INTO career_roles (slug, title, team, skills, sort) VALUES
  ('product-engineer-tech-ai', 'Product Engineer (Tech & AI)', 'Engineering',
   'TypeScript · PostgreSQL · LLM interfaces · Scaling platforms', 1),
  ('workforce-operations-lead', 'Workforce Operations Lead', 'Operations',
   'Operations · Partner success · Onboarding logistics · Frontline coordination', 2),
  ('customer-support-success', 'Customer Support & Success', 'Customer Success',
   'Candidate relations · Support tickets · Frontline outreach', 3)
ON CONFLICT (slug) DO NOTHING;
