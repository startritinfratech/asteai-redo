-- Disputes on contracts (and their milestones), with a message thread and admin resolution
-- that moves escrow money.
--
--   disputes          one per complaint. Raising one freezes the contract (status
--                     'disputed', previous status kept in previous_contract_status) until the
--                     last open dispute on it is resolved or withdrawn. An admin resolves it:
--                     release_to_expert | refund_to_buyer | split | no_action.
--   dispute_messages  the thread: both parties and admins post; admins can also post
--                     internal notes (is_internal) that the parties never see.
--
-- The table already exists (migration 001, project-level disputes with free-text reason and
-- resolution). It is extended in place, nothing is dropped:
--   raised_against → against_user, reason → description, resolution (free text) →
--   resolution_note, timeline (JSONB) → legacy_timeline (kept, read-only history).
-- Existing rows are marked source = 'legacy_project'; contract_id is filled from the
-- project's latest contract when there is one (it stays NULL otherwise, which only legacy
-- rows may have). Old statuses map 'Open' → open, 'Resolved'/'Closed' → resolved (with
-- resolved_at = updated_at), 'Withdrawn' → withdrawn, anything else → under_review. Legacy
-- rows have reason_code 'other', resolution NULL and respond_by = created_at + 72h, and are
-- exempt from the one-open-dispute-per-milestone index (duplicates may exist in old data).

-- ─── Renames (guarded so a partly applied run can be repeated) ──────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'disputes' AND column_name = 'raised_against') THEN
    ALTER TABLE disputes RENAME COLUMN raised_against TO against_user;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'disputes' AND column_name = 'reason') THEN
    ALTER TABLE disputes RENAME COLUMN reason TO description;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'disputes' AND column_name = 'resolution')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'disputes' AND column_name = 'resolution_note') THEN
    ALTER TABLE disputes RENAME COLUMN resolution TO resolution_note;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'disputes' AND column_name = 'timeline') THEN
    ALTER TABLE disputes RENAME COLUMN timeline TO legacy_timeline;
  END IF;
END $$;

-- Every row present now predates this migration: the column default marks them legacy,
-- then the default switches to 'app' for new rows.
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS source VARCHAR(24) NOT NULL DEFAULT 'legacy_project';
ALTER TABLE disputes ALTER COLUMN source SET DEFAULT 'app';

ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS contract_id              VARCHAR(32)    REFERENCES contracts(id),
  ADD COLUMN IF NOT EXISTS milestone_id             UUID           REFERENCES contract_milestones(id),
  ADD COLUMN IF NOT EXISTS reason_code              VARCHAR(24)    NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS amount_in_dispute        NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS respond_by               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution               VARCHAR(24),
  ADD COLUMN IF NOT EXISTS split_expert_amount      NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS split_buyer_amount       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS resolved_by              UUID           REFERENCES user_accounts(id),
  ADD COLUMN IF NOT EXISTS resolved_at              TIMESTAMPTZ,
  -- The contract's status when the dispute was raised (restored when the last open dispute closes).
  ADD COLUMN IF NOT EXISTS previous_contract_status VARCHAR(24),
  -- Set when the SLA sweep moved the dispute to review because the respondent did not answer in time.
  ADD COLUMN IF NOT EXISTS escalated_at             TIMESTAMPTZ;

ALTER TABLE disputes ALTER COLUMN legacy_timeline DROP NOT NULL;
ALTER TABLE disputes ALTER COLUMN legacy_timeline DROP DEFAULT;

-- ─── Legacy data ────────────────────────────────────────────────────────────
UPDATE disputes d
   SET contract_id = (SELECT c.id FROM contracts c WHERE c.project_id = d.project_id ORDER BY c.created_at DESC LIMIT 1)
 WHERE d.source = 'legacy_project' AND d.contract_id IS NULL AND d.project_id IS NOT NULL;

UPDATE disputes
   SET status = CASE lower(status)
                  WHEN 'open' THEN 'open'
                  WHEN 'resolved' THEN 'resolved'
                  WHEN 'closed' THEN 'resolved'
                  WHEN 'withdrawn' THEN 'withdrawn'
                  ELSE 'under_review'
                END,
       respond_by = COALESCE(respond_by, created_at + INTERVAL '72 hours'),
       previous_contract_status = COALESCE(previous_contract_status, 'active')
 WHERE source = 'legacy_project'
   AND status NOT IN ('open', 'awaiting_response', 'under_review', 'resolved', 'withdrawn');

UPDATE disputes SET resolved_at = updated_at
 WHERE source = 'legacy_project' AND status = 'resolved' AND resolved_at IS NULL;

UPDATE disputes SET respond_by = created_at + INTERVAL '72 hours' WHERE respond_by IS NULL;

ALTER TABLE disputes ALTER COLUMN status SET DEFAULT 'open';
ALTER TABLE disputes ALTER COLUMN respond_by SET NOT NULL;

-- ─── Constraints ────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE disputes ADD CONSTRAINT disputes_status_check
    CHECK (status IN ('open', 'awaiting_response', 'under_review', 'resolved', 'withdrawn'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE disputes ADD CONSTRAINT disputes_reason_code_check
    CHECK (reason_code IN ('quality', 'scope', 'non_delivery', 'late', 'payment', 'communication', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE disputes ADD CONSTRAINT disputes_resolution_check
    CHECK (resolution IS NULL OR resolution IN ('release_to_expert', 'refund_to_buyer', 'split', 'no_action'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE disputes ADD CONSTRAINT disputes_amounts_check
    CHECK ((amount_in_dispute IS NULL OR amount_in_dispute >= 0)
       AND (split_expert_amount IS NULL OR split_expert_amount >= 0)
       AND (split_buyer_amount IS NULL OR split_buyer_amount >= 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Only migrated rows may lack a contract, or carry an over-long description.
DO $$ BEGIN
  ALTER TABLE disputes ADD CONSTRAINT disputes_contract_required
    CHECK (contract_id IS NOT NULL OR source = 'legacy_project');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE disputes ADD CONSTRAINT disputes_description_length
    CHECK (char_length(description) <= 4000 OR source = 'legacy_project');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE disputes ADD CONSTRAINT disputes_resolved_fields
    CHECK (status <> 'resolved' OR source = 'legacy_project' OR (resolution IS NOT NULL AND resolved_at IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Indexes ────────────────────────────────────────────────────────────────
-- One open dispute per contract milestone; a contract-level dispute (milestone_id NULL)
-- counts as its own slot. Legacy rows are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS uq_disputes_open_per_milestone
  ON disputes (contract_id, COALESCE(milestone_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status IN ('open', 'awaiting_response', 'under_review') AND source = 'app';

CREATE INDEX IF NOT EXISTS idx_disputes_contract   ON disputes (contract_id, status);
CREATE INDEX IF NOT EXISTS idx_disputes_raised_by  ON disputes (raised_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disputes_against    ON disputes (against_user, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disputes_status     ON disputes (status, created_at DESC);
-- The SLA sweep: open disputes past their respond_by.
CREATE INDEX IF NOT EXISTS idx_disputes_respond_by ON disputes (respond_by) WHERE status = 'open';

-- ─── Messages ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispute_messages (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  dispute_id      VARCHAR(32)   NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  author_id       UUID          NOT NULL REFERENCES user_accounts(id),
  body            TEXT          NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  -- https links only, at most 10 (also checked by the API).
  evidence_links  TEXT[]        NOT NULL DEFAULT '{}' CHECK (cardinality(evidence_links) <= 10),
  -- Admin-only notes: never shown to the parties.
  is_internal     BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispute_messages_dispute ON dispute_messages (dispute_id, created_at);
