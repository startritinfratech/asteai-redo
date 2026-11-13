-- Public job board. A "job" is a requisition its employer chose to publish (is_public)
-- while it is Open. These columns carry what a public posting needs and an internal
-- requisition did not: employment / location type, pay range, requirement bullets, an
-- expiry, and the candidate-facing deadlines.
--
-- tenants.is_test hides a whole tenant (demo / QA companies) from every public listing,
-- so test postings cannot reach the live board. logo_url / website show on job cards.

ALTER TABLE requisitions
  ADD COLUMN IF NOT EXISTS is_public                 BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS employment_type           VARCHAR(12)  NOT NULL DEFAULT 'full_time',
  ADD COLUMN IF NOT EXISTS location_type             VARCHAR(8)   NOT NULL DEFAULT 'onsite',
  ADD COLUMN IF NOT EXISTS salary_min                NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS salary_max                NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS salary_currency           CHAR(3)      NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS requirements              TEXT[]       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS expires_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reapply_after_days        SMALLINT     NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS assessment_deadline_hours SMALLINT     NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS interview_deadline_hours  SMALLINT     NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS frontline_role            TEXT;

DO $$ BEGIN
  ALTER TABLE requisitions ADD CONSTRAINT requisitions_employment_type_chk
    CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'internship'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE requisitions ADD CONSTRAINT requisitions_location_type_chk
    CHECK (location_type IN ('onsite', 'remote', 'hybrid'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE requisitions ADD CONSTRAINT requisitions_salary_range_chk
    CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS is_test   BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS logo_url  TEXT,
  ADD COLUMN IF NOT EXISTS website   TEXT;

-- The board's list query: open + public, newest first (keyset pagination on published_at, id).
CREATE INDEX IF NOT EXISTS idx_requisitions_public_board
  ON requisitions(published_at DESC, id DESC) WHERE is_public AND status = 'Open';
