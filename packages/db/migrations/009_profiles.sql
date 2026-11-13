-- Migration: 009_profiles.sql
-- Freelancer (expert) and buyer profiles, the public expert directory and reviews.
--
-- expert_profiles.status is the approval workflow:
--   draft → (freelancer submits) pending → (admin) approved | rejected | rework
--   rejected / rework → (freelancer edits and resubmits) pending
-- Only 'approved' profiles are listed publicly (GET /experts).
--
-- expert_profiles.search is a generated tsvector over headline, summary, skills and
-- domains (weighted A–D) used by plainto_tsquery in the directory search.
--
-- reviews: one per (project, reviewer, reviewee). rating / review_count on
-- expert_profiles are kept in step by the API in the same transaction as the insert.

-- array_to_string is only STABLE, so wrap it in an IMMUTABLE function for the
-- generated column (safe: the separator is fixed and text[] → text has no locale input).
CREATE OR REPLACE FUNCTION asteai_immutable_array_to_string(text[])
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT array_to_string($1, ' ') $$;

CREATE TABLE IF NOT EXISTS expert_profiles (
  user_id           UUID          PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  headline          VARCHAR(140)  NOT NULL DEFAULT '',
  summary           VARCHAR(4000) NOT NULL DEFAULT '',
  domains           TEXT[]        NOT NULL DEFAULT '{}',
  skills            TEXT[]        NOT NULL DEFAULT '{}',
  languages         TEXT[]        NOT NULL DEFAULT '{}',
  years_experience  SMALLINT      CHECK (years_experience BETWEEN 0 AND 60),
  hourly_rate       NUMERIC(10,2) CHECK (hourly_rate >= 0),
  daily_rate        NUMERIC(10,2) CHECK (daily_rate >= 0),
  fixed_from        NUMERIC(10,2) CHECK (fixed_from >= 0),
  currency          CHAR(3)       NOT NULL DEFAULT 'INR',
  engagement_modes  TEXT[]        NOT NULL DEFAULT '{}'
                    CHECK (engagement_modes <@ ARRAY['hourly','daily','fixed','sprint']::text[]),
  availability      VARCHAR(16)   NOT NULL DEFAULT 'available'
                    CHECK (availability IN ('available', 'limited', 'unavailable')),
  location          VARCHAR(120),
  portfolio_url     VARCHAR(300),
  linkedin_url      VARCHAR(300),
  github_url        VARCHAR(300),
  status            VARCHAR(16)   NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'rework')),
  admin_note        VARCHAR(2000),
  reviewed_by       UUID          REFERENCES user_accounts(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  rating            NUMERIC(3,2)  NOT NULL DEFAULT 0,
  review_count      INTEGER       NOT NULL DEFAULT 0,
  completion        SMALLINT      NOT NULL DEFAULT 0 CHECK (completion BETWEEN 0 AND 100),
  search            TSVECTOR GENERATED ALWAYS AS (
                      setweight(to_tsvector('english', coalesce(headline, '')), 'A') ||
                      setweight(to_tsvector('english', asteai_immutable_array_to_string(skills)), 'B') ||
                      setweight(to_tsvector('english', asteai_immutable_array_to_string(domains)), 'C') ||
                      setweight(to_tsvector('english', coalesce(summary, '')), 'D')
                    ) STORED,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expert_profiles_search  ON expert_profiles USING GIN (search);
CREATE INDEX IF NOT EXISTS idx_expert_profiles_status  ON expert_profiles (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_expert_profiles_skills  ON expert_profiles USING GIN (skills);
CREATE INDEX IF NOT EXISTS idx_expert_profiles_domains ON expert_profiles USING GIN (domains);

CREATE TABLE IF NOT EXISTS buyer_profiles (
  user_id       UUID          PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  company_name  VARCHAR(160),
  industry      VARCHAR(120),
  website       VARCHAR(300),
  country       VARCHAR(80),
  about         VARCHAR(4000),
  completion    SMALLINT      NOT NULL DEFAULT 0 CHECK (completion BETWEEN 0 AND 100),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id   VARCHAR(32)   REFERENCES projects(id) ON DELETE SET NULL,
  reviewer_id  UUID          NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  reviewee_id  UUID          NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  rating       SMALLINT      NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      VARCHAR(2000) NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CHECK (reviewer_id <> reviewee_id),
  UNIQUE (project_id, reviewer_id, reviewee_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews (reviewee_id, created_at DESC);
