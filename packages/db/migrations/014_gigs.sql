-- Gigs: pre-packaged services that experts publish and buyers order.
--
--   services          the listing (draft → pending → published | rejected; published ⇄ paused).
--                     Only approved experts submit; an admin publishes. `search` is a
--                     generated tsvector (title A, tags B, summary C, description D).
--   service_packages  1–3 tiers (basic / standard / premium) with price, delivery days,
--                     revisions and a feature list.
--   gig_orders        an order for one package. It REUSES the contracts machinery: ordering
--                     creates a contract (source 'gig', engagement 'fixed', one milestone,
--                     status 'active' at once: the package terms are the agreement and
--                     accepted_terms_at records the buyer's acceptance), so funding
--                     (Razorpay), escrow, release, invoices, disputes, refunds and chat all
--                     work without a second money path. price / delivery_days / revisions
--                     are snapshotted from the package at order time.
--   gig_deliveries    what the expert handed over each time they delivered (note + links).
--
-- gig_orders.status is DERIVED from the contract's single milestone and kept in step by the
-- trigger below, in the same transaction as every milestone change (payment capture, submit,
-- revision, accept/release, cancel, dispute settlement), so no code path can forget it:
--   milestone pending → awaiting_payment, funded → in_progress, submitted | accepted →
--   delivered, revision_requested → revision_requested, released → completed,
--   cancelled → cancelled.
-- (Keep this mapping identical to gigOrderStatusFor in modules/gigs/gig-rules.ts.)
--
-- reviews gets a nullable gig_order_id so a completed order can be reviewed through the
-- existing reviews table (project_id is NULL for those rows).

CREATE TABLE IF NOT EXISTS services (
  id            VARCHAR(32)   PRIMARY KEY,                         -- 'SVC-…'
  expert_id     UUID          NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  title         VARCHAR(120)  NOT NULL,
  slug          VARCHAR(160)  NOT NULL UNIQUE,
  category      VARCHAR(60)   NOT NULL DEFAULT 'Other',
  summary       VARCHAR(300)  NOT NULL DEFAULT '',
  description   VARCHAR(5000) NOT NULL DEFAULT '',
  tags          TEXT[]        NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 10),
  status        VARCHAR(16)   NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'pending', 'published', 'paused', 'rejected')),
  admin_note    VARCHAR(2000),
  reviewed_by   UUID          REFERENCES user_accounts(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  rating        NUMERIC(3,2)  NOT NULL DEFAULT 0,
  review_count  INTEGER       NOT NULL DEFAULT 0,
  search        TSVECTOR GENERATED ALWAYS AS (
                  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                  setweight(to_tsvector('english', asteai_immutable_array_to_string(tags)), 'B') ||
                  setweight(to_tsvector('english', coalesce(summary, '')), 'C') ||
                  setweight(to_tsvector('english', coalesce(description, '')), 'D')
                ) STORED,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_services_search   ON services USING GIN (search);
CREATE INDEX IF NOT EXISTS idx_services_expert   ON services (expert_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_services_status   ON services (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_services_category ON services (category) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS service_packages (
  id            VARCHAR(32)   PRIMARY KEY,                         -- 'PKG-…'
  service_id    VARCHAR(32)   NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  tier          VARCHAR(16)   NOT NULL CHECK (tier IN ('basic', 'standard', 'premium')),
  name          VARCHAR(80)   NOT NULL,
  description   VARCHAR(1000) NOT NULL DEFAULT '',
  price         NUMERIC(12,2) NOT NULL CHECK (price > 0),
  delivery_days SMALLINT      NOT NULL CHECK (delivery_days BETWEEN 1 AND 180),
  revisions     SMALLINT      NOT NULL DEFAULT 0 CHECK (revisions BETWEEN 0 AND 10),
  features      TEXT[]        NOT NULL DEFAULT '{}',
  -- FALSE once the expert dropped a tier that already has orders: the row stays (orders join
  -- it) but it is no longer sold, listed or priced. Re-adding the tier sets it TRUE again.
  active        BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, tier)
);

CREATE TABLE IF NOT EXISTS gig_orders (
  id                VARCHAR(32)   PRIMARY KEY,                     -- 'ORD-…'
  service_id        VARCHAR(32)   NOT NULL REFERENCES services(id),
  package_id        VARCHAR(32)   NOT NULL REFERENCES service_packages(id),
  buyer_id          UUID          NOT NULL REFERENCES user_accounts(id),
  expert_id         UUID          NOT NULL REFERENCES user_accounts(id),
  requirements      VARCHAR(4000) NOT NULL,
  price             NUMERIC(12,2) NOT NULL CHECK (price > 0),
  delivery_days     SMALLINT      NOT NULL CHECK (delivery_days BETWEEN 1 AND 180),
  revisions         SMALLINT      NOT NULL CHECK (revisions BETWEEN 0 AND 10),
  -- Set right after the contract row is inserted (same transaction).
  contract_id       VARCHAR(32)   UNIQUE REFERENCES contracts(id),
  status            VARCHAR(24)   NOT NULL DEFAULT 'awaiting_payment'
                    CHECK (status IN ('awaiting_payment', 'in_progress', 'delivered', 'revision_requested',
                                      'completed', 'cancelled')),
  due_at            TIMESTAMPTZ,                                   -- set when the order is funded
  delivered_at      TIMESTAMPTZ,
  -- Sweep bookkeeping (GigSweepService): each is set once so a notice goes out only once.
  reminder_sent_at    TIMESTAMPTZ,                                 -- "auto-accepts in 2 days" sent
  overdue_notified_at TIMESTAMPTZ,                                 -- "delivery is overdue" sent
  accepted_terms_at TIMESTAMPTZ   NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CHECK (buyer_id <> expert_id)
);

CREATE INDEX IF NOT EXISTS idx_gig_orders_buyer  ON gig_orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gig_orders_expert ON gig_orders (expert_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gig_orders_status ON gig_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gig_orders_sweep  ON gig_orders (delivered_at) WHERE status = 'delivered';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_contracts_gig_order') THEN
    ALTER TABLE contracts ADD CONSTRAINT fk_contracts_gig_order
      FOREIGN KEY (gig_order_id) REFERENCES gig_orders(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS gig_deliveries (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    VARCHAR(32)   NOT NULL REFERENCES gig_orders(id) ON DELETE CASCADE,
  expert_id   UUID          NOT NULL REFERENCES user_accounts(id),
  note        VARCHAR(4000) NOT NULL,
  links       TEXT[]        NOT NULL DEFAULT '{}' CHECK (cardinality(links) <= 10),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gig_deliveries_order ON gig_deliveries (order_id, created_at);

-- ─── Order status follows the contract milestone ────────────────────────────
CREATE OR REPLACE FUNCTION asteai_sync_gig_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE gig_orders go
     SET status = CASE NEW.status
                    WHEN 'pending' THEN 'awaiting_payment'
                    WHEN 'funded' THEN 'in_progress'
                    WHEN 'submitted' THEN 'delivered'
                    WHEN 'accepted' THEN 'delivered'
                    WHEN 'revision_requested' THEN 'revision_requested'
                    WHEN 'released' THEN 'completed'
                    ELSE 'cancelled'
                  END,
         due_at = CASE WHEN NEW.status = 'funded' AND go.due_at IS NULL
                       THEN NOW() + make_interval(days => go.delivery_days) ELSE go.due_at END,
         delivered_at = CASE WHEN NEW.status = 'submitted' THEN NOW() ELSE go.delivered_at END,
         -- a fresh delivery (after a revision) gets its own auto-accept reminder
         reminder_sent_at = CASE WHEN NEW.status = 'submitted' THEN NULL ELSE go.reminder_sent_at END,
         updated_at = NOW()
   WHERE go.contract_id = NEW.contract_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_sync_gig_order ON contract_milestones;
CREATE TRIGGER trg_sync_gig_order
  AFTER UPDATE OF status ON contract_milestones
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION asteai_sync_gig_order();

-- ─── Reviews of completed orders ────────────────────────────────────────────
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS gig_order_id VARCHAR(32) REFERENCES gig_orders(id) ON DELETE SET NULL;
-- UNIQUE (project_id, …) does not constrain NULL project_ids, so gig reviews get their own key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_gig_order
  ON reviews (gig_order_id, reviewer_id) WHERE gig_order_id IS NOT NULL;
