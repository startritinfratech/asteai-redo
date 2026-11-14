-- Enterprise Hire & ATS: job approval before public listing, AI-generated screening and
-- rubrics on requisitions, the Screened pipeline stage, Talent CRM Kanban pools, and bulk
-- outreach campaigns with per-campaign rate limits and delivery tracking.

-- ── Pipeline: applied → screened → interview → shortlist → offer ──────────────
-- (ADD VALUE is allowed in a transaction on PostgreSQL 12+; the value isn't used below.)
ALTER TYPE application_stage_enum ADD VALUE IF NOT EXISTS 'Screened' AFTER 'Applied';

-- ── Requisition approval ──────────────────────────────────────────────────────
-- A requisition reaches the public job board only once an admin approved it. Editing a
-- public-facing field of an approved one sends it back to 'pending'.
ALTER TABLE requisitions
  ADD COLUMN IF NOT EXISTS approval_status      VARCHAR(10) NOT NULL DEFAULT 'draft'
                                                CHECK (approval_status IN ('draft', 'pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approval_note        TEXT,
  ADD COLUMN IF NOT EXISTS approval_reviewed_by UUID REFERENCES user_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS screening_questions  JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS evaluation_rubric    JSONB NOT NULL DEFAULT '[]';

-- Jobs already live on the board stay live: they were published before review existed.
UPDATE requisitions SET approval_status = 'approved', approval_reviewed_at = NOW()
 WHERE is_public AND approval_status = 'draft';

CREATE INDEX IF NOT EXISTS idx_requisitions_approval_queue
  ON requisitions(approval_submitted_at) WHERE approval_status = 'pending';

-- ── AI Job Creator is a metered AI feature ────────────────────────────────────
INSERT INTO credit_costs (feature, label, cost, cost_max, sort) VALUES
  ('ai_job_creator', 'AI job description, screening & rubric', 15, NULL, 13)
ON CONFLICT (feature) DO NOTHING;

-- ── Talent CRM pools (Kanban) ─────────────────────────────────────────────────

-- 001 has summary-only tables with prefixed text IDs. Use separate tables for
-- the UUID-based boards and campaigns so the original tenant endpoints still work.
CREATE TABLE IF NOT EXISTS ats_talent_pools (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    VARCHAR(64)   NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         VARCHAR(120)  NOT NULL,
  description  TEXT          NOT NULL DEFAULT '',
  -- Ordered Kanban columns: [{ "key": "sourced", "label": "Sourced" }, …]
  columns      JSONB         NOT NULL,
  created_by   UUID          REFERENCES user_accounts(id) ON DELETE SET NULL,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ats_talent_pools_tenant ON ats_talent_pools(tenant_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS talent_pool_members (
  id          UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  pool_id     UUID              NOT NULL REFERENCES ats_talent_pools(id) ON DELETE CASCADE,
  -- A platform user, or an external prospect known only by email.
  user_id     UUID              REFERENCES user_accounts(id) ON DELETE SET NULL,
  email       VARCHAR(255)      NOT NULL,
  full_name   VARCHAR(160)      NOT NULL DEFAULT '',
  column_key  VARCHAR(40)       NOT NULL,
  -- Fractional ordering inside a column: a move writes one row.
  position    DOUBLE PRECISION  NOT NULL,
  tags        TEXT[]            NOT NULL DEFAULT '{}',
  notes       TEXT              NOT NULL DEFAULT '',
  added_by    UUID              REFERENCES user_accounts(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_talent_pool_member_email ON talent_pool_members(pool_id, LOWER(email));
CREATE INDEX IF NOT EXISTS idx_talent_pool_members_board ON talent_pool_members(pool_id, column_key, position);

-- ── Bulk outreach ─────────────────────────────────────────────────────────────
-- A campaign renders one message per recipient when queued. Messages are released to
-- email_outbox by the dispatcher no faster than rate_per_minute (send_after staggers
-- them), so delivery status comes from the outbox row each message points at.

CREATE TABLE IF NOT EXISTS ats_outreach_campaigns (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         VARCHAR(64)   NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by        UUID          REFERENCES user_accounts(id) ON DELETE SET NULL,
  name              VARCHAR(120)  NOT NULL,
  subject_template  VARCHAR(200)  NOT NULL,
  body_template     TEXT          NOT NULL CHECK (char_length(body_template) <= 10000),
  requisition_id    VARCHAR(64)   REFERENCES requisitions(id) ON DELETE SET NULL,
  pool_id           UUID          REFERENCES ats_talent_pools(id) ON DELETE SET NULL,
  status            VARCHAR(10)   NOT NULL DEFAULT 'draft'
                                  CHECK (status IN ('draft', 'queued', 'completed', 'cancelled')),
  rate_per_minute   SMALLINT      NOT NULL DEFAULT 60 CHECK (rate_per_minute BETWEEN 1 AND 300),
  recipients        JSONB         NOT NULL DEFAULT '[]',
  queued_at         TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ats_outreach_campaigns_tenant ON ats_outreach_campaigns(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS outreach_messages (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id  UUID          NOT NULL REFERENCES ats_outreach_campaigns(id) ON DELETE CASCADE,
  tenant_id    VARCHAR(64)   NOT NULL,
  to_email     VARCHAR(255)  NOT NULL,
  to_name      VARCHAR(160)  NOT NULL DEFAULT '',
  subject      VARCHAR(250)  NOT NULL,
  body         TEXT          NOT NULL,
  -- queued → released (handed to email_outbox) ; or skipped (suppressed) / cancelled
  status       VARCHAR(10)   NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued', 'released', 'skipped', 'cancelled')),
  outbox_id    UUID          REFERENCES email_outbox(id) ON DELETE SET NULL,
  send_after   TIMESTAMPTZ   NOT NULL,
  released_at  TIMESTAMPTZ,
  skip_reason  VARCHAR(40),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_message_recipient ON outreach_messages(campaign_id, LOWER(to_email));
CREATE INDEX IF NOT EXISTS idx_outreach_messages_due ON outreach_messages(send_after) WHERE status = 'queued';

-- Addresses that unsubscribed from a tenant's outreach. Checked at queue and at release.
CREATE TABLE IF NOT EXISTS outreach_suppressions (
  tenant_id   VARCHAR(64)   NOT NULL,
  email       VARCHAR(255)  NOT NULL,
  reason      VARCHAR(20)   NOT NULL DEFAULT 'unsubscribed',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, email)
);
