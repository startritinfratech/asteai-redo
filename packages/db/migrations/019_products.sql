-- Digital products (models, codebases, blueprints, API kits) that experts sell.
-- Lifecycle mirrors services: draft → pending (submitted) → active | rejected; active ⇄ paused.
-- Only 'active' products are public. Purchases (Razorpay + signed download links) arrive in
-- Phase 3. file_key points at the private S3 object and is never returned publicly.

CREATE TABLE IF NOT EXISTS products (
  id            VARCHAR(32)   PRIMARY KEY,                                 -- 'PRD-…'
  seller_id     UUID          NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  slug          VARCHAR(140)  NOT NULL UNIQUE,
  title         VARCHAR(120)  NOT NULL,
  summary       VARCHAR(300)  NOT NULL DEFAULT '',
  description   TEXT          NOT NULL DEFAULT '' CHECK (char_length(description) <= 10000),
  category      VARCHAR(60)   NOT NULL,
  tags          TEXT[]        NOT NULL DEFAULT '{}',
  price_minor   INTEGER       NOT NULL CHECK (price_minor > 0),
  currency      CHAR(3)       NOT NULL DEFAULT 'INR',
  license       VARCHAR(20)   NOT NULL DEFAULT 'single_team'
                              CHECK (license IN ('single_team', 'organisation', 'open_source')),
  file_key      TEXT,
  status        VARCHAR(10)   NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'pending', 'active', 'paused', 'rejected')),
  review_note   TEXT,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(published_at DESC, id DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_products_pending ON products(updated_at) WHERE status = 'pending';
