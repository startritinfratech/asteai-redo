-- Contracts as a first-class entity: one contract per awarded proposal, with its own
-- milestones and escrow accounting.
--
--   contracts            the agreement (terms, NDA, signatures, escrow totals)
--   contract_milestones  deliverables; money moves milestone by milestone
--   escrow_payments      one row per attempt to fund a milestone. A milestone only becomes
--                        'funded' when its payment is captured (payment-provider webhook,
--                        or the admin stand-in until that exists). provider_payment_id is
--                        UNIQUE so a replayed capture is idempotent.
--
-- contracts.escrow_funded / released are running totals kept in the same transaction as
-- the milestone change and the ledger_entries row ('Escrow hold' / 'Escrow release').
--
-- The data migration at the bottom copies projects.milestones (JSONB) of awarded projects
-- into contracts + contract_milestones (source = 'legacy_project'). Idempotent: a project
-- whose awarded proposal already has a contract is skipped.

CREATE TABLE IF NOT EXISTS contracts (
  id                  VARCHAR(32)    PRIMARY KEY,                    -- 'CT-…' (generateId)
  -- project_id / proposal_id are NULL for a gig contract (source = 'gig'): ordering a
  -- pre-packaged service creates the contract directly, with no project or proposal.
  -- (014_gigs.sql adds the foreign key for gig_order_id.)
  project_id          VARCHAR(32)    REFERENCES projects(id),
  proposal_id         VARCHAR(32)    UNIQUE REFERENCES proposals(id),
  gig_order_id        VARCHAR(32)    UNIQUE,
  -- Shown instead of the project title when there is no project (a gig contract: the gig title).
  title               VARCHAR(200),
  tenant_id           VARCHAR(64)    REFERENCES tenants(id) ON DELETE SET NULL,
  buyer_id            UUID           NOT NULL REFERENCES user_accounts(id),
  expert_id           UUID           NOT NULL REFERENCES user_accounts(id),
  engagement_model    VARCHAR(16)    NOT NULL CHECK (engagement_model IN ('fixed', 'hourly', 'daily', 'sprint')),
  payment_terms       JSONB          NOT NULL DEFAULT '{}',
  currency            CHAR(3)        NOT NULL DEFAULT 'INR',
  total_amount        NUMERIC(12,2)  NOT NULL CHECK (total_amount > 0),
  escrow_funded       NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (escrow_funded >= 0),
  released            NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (released >= 0),
  status              VARCHAR(24)    NOT NULL DEFAULT 'pending_signature'
                      CHECK (status IN ('draft', 'pending_signature', 'active', 'completed', 'cancelled', 'disputed')),
  nda_required        BOOLEAN        NOT NULL DEFAULT FALSE,
  nda_text            TEXT,
  buyer_signed_at     TIMESTAMPTZ,
  expert_signed_at    TIMESTAMPTZ,
  buyer_signature     VARCHAR(200),
  expert_signature    VARCHAR(200),
  buyer_signature_ip  VARCHAR(64),
  expert_signature_ip VARCHAR(64),
  cancelled_by        UUID           REFERENCES user_accounts(id),
  cancel_reason       TEXT,
  -- Escrow still held when the contract was cancelled (escrow_funded − released): owed back
  -- to the buyer. Set by an admin cancel; the refund itself is processed outside the app.
  refund_due          NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (refund_due >= 0),
  source              VARCHAR(24)    NOT NULL DEFAULT 'app',         -- 'app' | 'legacy_project' | 'gig'
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CHECK (buyer_id <> expert_id),
  CHECK (source = 'gig' OR (project_id IS NOT NULL AND proposal_id IS NOT NULL)),
  CHECK (released <= escrow_funded),
  CHECK (escrow_funded <= total_amount)
);

-- "My contracts" for each side, optionally filtered by status, newest first.
CREATE INDEX IF NOT EXISTS idx_contracts_buyer   ON contracts (buyer_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_expert  ON contracts (expert_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_status  ON contracts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts (project_id);

CREATE TABLE IF NOT EXISTS contract_milestones (
  id               UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id      VARCHAR(32)    NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  seq              SMALLINT       NOT NULL CHECK (seq > 0),
  title            VARCHAR(200)   NOT NULL,
  amount           NUMERIC(12,2)  NOT NULL CHECK (amount > 0),
  due_date         DATE,
  status           VARCHAR(24)    NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'funded', 'submitted', 'revision_requested', 'accepted', 'released', 'cancelled')),
  funded_at        TIMESTAMPTZ,
  submitted_at     TIMESTAMPTZ,
  accepted_at      TIMESTAMPTZ,
  released_at      TIMESTAMPTZ,
  revision_count   SMALLINT       NOT NULL DEFAULT 0,
  submission_note  TEXT,
  revision_note    TEXT,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, seq)
);

CREATE TABLE IF NOT EXISTS escrow_payments (
  id                   UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id          VARCHAR(32)    NOT NULL REFERENCES contracts(id),
  milestone_id         UUID           NOT NULL REFERENCES contract_milestones(id),
  amount               NUMERIC(12,2)  NOT NULL CHECK (amount > 0),
  currency             CHAR(3)        NOT NULL DEFAULT 'INR',
  provider             TEXT           NOT NULL DEFAULT 'pending',      -- e.g. 'razorpay' once wired
  provider_payment_id  TEXT           UNIQUE,
  status               VARCHAR(16)    NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'captured', 'failed')),
  created_by           UUID           REFERENCES user_accounts(id),
  captured_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CHECK (status <> 'captured' OR provider_payment_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_escrow_payments_milestone ON escrow_payments (milestone_id);
-- At most one open payment request per milestone (fund is idempotent under concurrency).
CREATE UNIQUE INDEX IF NOT EXISTS uq_escrow_payments_open
  ON escrow_payments (milestone_id) WHERE status = 'pending';

-- ─── Data migration: projects.milestones → contracts ────────────────────────
-- For every awarded project whose awarded proposal has no contract yet:
--   * a 'fixed' contract for the sum of its (positive) milestone amounts, or the proposal
--     price when it has none, as a single 'Full delivery' milestone;
--   * legacy milestone statuses: the old "Funded / Submitted / Revision requested /
--     Accepted / Disputed" were status flips with no captured payment behind them, so
--     they must NOT count as escrow (a buyer could otherwise "release" money that was
--     never paid in). Only 'Released' maps to 'released' (historical, settled outside the
--     platform); every other legacy status maps to 'pending' and needs a real payment.
--     The old status is kept in submission_note as 'Legacy status: <old>' so the history
--     is not lost. A project in stage 'Disputed' makes the contract 'disputed';
--   * escrow_funded = released = the sum of the released milestones (no ledger rows are
--     written here; those amounts were settled before this platform held escrow).
-- Migrated contracts count as signed under the old flow (status 'active'), with null
-- signatures; source = 'legacy_project' marks them.
DO $$
DECLARE
  r       RECORD;
  cid     VARCHAR(32);
  m       JSONB;
  n       INT;
  amt     NUMERIC(12,2);
  due     DATE;
  mstatus TEXT;
  total   NUMERIC(12,2);
  funded  NUMERIC(12,2);
  rel     NUMERIC(12,2);
  open_n  INT;
BEGIN
  FOR r IN
    SELECT pj.id AS project_id, pj.tenant_id, pj.buyer_id, pj.awarded_to, pj.stage::text AS stage,
           pj.milestones, pj.nda_required, pr.id AS proposal_id, pr.price
      FROM projects pj
      JOIN proposals pr
        ON pr.project_id = pj.id AND pr.expert_id = pj.awarded_to AND pr.status = 'Awarded'
     WHERE pj.awarded_to IS NOT NULL
       AND pj.awarded_to <> pj.buyer_id
       AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.proposal_id = pr.id)
  LOOP
    cid := 'CT-' || upper(substr(md5('legacy:' || r.proposal_id), 1, 8));
    IF EXISTS (SELECT 1 FROM contracts WHERE id = cid) THEN CONTINUE; END IF;

    SELECT COALESCE(SUM((x->>'amount')::numeric), 0) INTO total
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.milestones) = 'array' THEN r.milestones ELSE '[]'::jsonb END) x
     WHERE jsonb_typeof(x->'amount') = 'number' AND (x->>'amount')::numeric > 0;
    IF total <= 0 THEN total := COALESCE(r.price, 0); END IF;
    IF total <= 0 THEN CONTINUE; END IF;   -- nothing to contract for

    INSERT INTO contracts (id, project_id, proposal_id, tenant_id, buyer_id, expert_id, engagement_model,
                           payment_terms, total_amount, status, nda_required, source)
    VALUES (cid, r.project_id, r.proposal_id, r.tenant_id, r.buyer_id, r.awarded_to, 'fixed',
            jsonb_build_object('totalAmount', total), total,
            CASE WHEN r.stage = 'Disputed' THEN 'disputed' ELSE 'active' END,
            r.nda_required, 'legacy_project');

    n := 0;
    FOR m IN
      SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.milestones) = 'array' THEN r.milestones ELSE '[]'::jsonb END) x
    LOOP
      IF jsonb_typeof(m->'amount') <> 'number' OR (m->>'amount')::numeric <= 0 THEN CONTINUE; END IF;
      n := n + 1;
      amt := (m->>'amount')::numeric;
      due := CASE WHEN jsonb_typeof(m->'dueDate') = 'number' AND (m->>'dueDate')::numeric > 0
                  THEN to_timestamp((m->>'dueDate')::numeric / 1000)::date END;
      mstatus := CASE WHEN m->>'status' = 'Released' THEN 'released' ELSE 'pending' END;
      INSERT INTO contract_milestones (contract_id, seq, title, amount, due_date, status, released_at, submission_note)
      VALUES (cid, n, left(COALESCE(NULLIF(trim(m->>'name'), ''), 'Milestone ' || n), 200), amt, due, mstatus,
              CASE WHEN mstatus = 'released' THEN NOW() END,
              CASE WHEN mstatus = 'pending' AND COALESCE(NULLIF(trim(m->>'status'), ''), 'Pending') <> 'Pending'
                   THEN 'Legacy status: ' || left(trim(m->>'status'), 100) END);
    END LOOP;

    IF n = 0 THEN
      INSERT INTO contract_milestones (contract_id, seq, title, amount) VALUES (cid, 1, 'Full delivery', total);
    END IF;

    -- Only released milestones carry money; escrow_funded = released for migrated contracts.
    SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'released'), 0),
           COUNT(*) FILTER (WHERE status <> 'released')
      INTO rel, open_n
      FROM contract_milestones WHERE contract_id = cid;
    funded := rel;

    UPDATE contracts
       SET escrow_funded = funded,
           released = rel,
           status = CASE WHEN status = 'active' AND (open_n = 0 OR r.stage = 'Completed') THEN 'completed' ELSE status END
     WHERE id = cid;
  END LOOP;
END $$;
