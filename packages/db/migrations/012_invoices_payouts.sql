-- Invoices for captured escrow payments, and expert payouts.
--
--   invoice_counters  per-year counter behind the invoice numbers INV-<year>-<000001>
--   invoices          one per captured escrow payment (escrow_payment_id UNIQUE makes
--                     InvoicesService.createForCapturedPayment idempotent). Names and titles
--                     are snapshots taken at issue time; the PDF is rendered on demand.
--   payout_accounts   where an expert wants to be paid: bank account or UPI id. The full
--                     details are AES-256-GCM sealed (PAYOUT_ENCRYPTION_KEY); only masked
--                     values are stored in the clear.
--   payout_requests   an expert asks to withdraw part of the available balance; an admin
--                     approves, pays manually (bank transfer outside the app) and records
--                     the UTR, or rejects. Paying writes one 'Payout' ledger row.

-- ─── Invoices ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invoice_counters (
  year  INT  PRIMARY KEY,
  last  INT  NOT NULL DEFAULT 0 CHECK (last >= 0)
);

CREATE TABLE IF NOT EXISTS invoices (
  id                 VARCHAR(32)    PRIMARY KEY,                     -- 'INV-2026-000123'
  contract_id        VARCHAR(32)    NOT NULL REFERENCES contracts(id),
  milestone_id       UUID           NOT NULL REFERENCES contract_milestones(id),
  escrow_payment_id  UUID           NOT NULL UNIQUE REFERENCES escrow_payments(id),
  buyer_id           UUID           NOT NULL REFERENCES user_accounts(id),
  expert_id          UUID           NOT NULL REFERENCES user_accounts(id),
  amount             NUMERIC(12,2)  NOT NULL CHECK (amount > 0),
  -- Platform fee: not charged yet (always 0); kept so a fee can be itemised later.
  platform_fee       NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  currency           CHAR(3)        NOT NULL DEFAULT 'INR',
  -- Tax: unset until GST invoicing is decided. Printed only when present.
  gstin              VARCHAR(15),
  tax_amount         NUMERIC(12,2)  CHECK (tax_amount IS NULL OR tax_amount >= 0),
  provider           TEXT,
  provider_payment_id TEXT,
  -- Snapshots at issue time (an invoice must not change when a name does).
  buyer_name         TEXT           NOT NULL DEFAULT '',
  buyer_email        TEXT           NOT NULL DEFAULT '',
  expert_name        TEXT           NOT NULL DEFAULT '',
  project_title      TEXT           NOT NULL DEFAULT '',
  milestone_seq      SMALLINT       NOT NULL,
  milestone_title    TEXT           NOT NULL,
  issued_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_buyer    ON invoices (buyer_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_expert   ON invoices (expert_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_issued   ON invoices (issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_contract ON invoices (contract_id);

-- ─── Payout accounts ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payout_accounts (
  user_id            UUID          PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  method             VARCHAR(8)    NOT NULL CHECK (method IN ('bank', 'upi')),
  account_holder     VARCHAR(100)  NOT NULL,
  -- seal(JSON {u, accountNumber, ifsc} | {u, upiId}) — see payouts/payout-crypto.ts
  details_encrypted  TEXT          NOT NULL,
  account_last4      CHAR(4),                          -- bank only
  ifsc               CHAR(11),                         -- bank only (IFSC is public)
  upi_masked         VARCHAR(120),                     -- upi only, e.g. 'ra****@okhdfc'
  -- TRUE once a payout to these exact details was marked paid; reset on every change.
  verified           BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CHECK (
    (method = 'bank' AND account_last4 IS NOT NULL AND ifsc IS NOT NULL AND upi_masked IS NULL) OR
    (method = 'upi'  AND upi_masked IS NOT NULL AND account_last4 IS NULL AND ifsc IS NULL)
  )
);

-- ─── Payout requests ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payout_requests (
  id                 UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            UUID           NOT NULL REFERENCES user_accounts(id),
  amount             NUMERIC(12,2)  NOT NULL CHECK (amount > 0),
  currency           CHAR(3)        NOT NULL DEFAULT 'INR',
  status             VARCHAR(12)    NOT NULL DEFAULT 'requested'
                     CHECK (status IN ('requested', 'approved', 'paid', 'rejected', 'cancelled')),
  -- The payout account at request time: masked copy for display, sealed copy for the admin
  -- who pays (so a later account change cannot redirect a request already approved).
  method             VARCHAR(8)     NOT NULL CHECK (method IN ('bank', 'upi')),
  account_holder     VARCHAR(100)   NOT NULL,
  account_masked     VARCHAR(160)   NOT NULL,
  details_encrypted  TEXT           NOT NULL,
  admin_note         TEXT,
  reference          VARCHAR(64),                      -- bank UTR / UPI reference, when paid
  requested_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  decided_at         TIMESTAMPTZ,
  decided_by         UUID           REFERENCES user_accounts(id),
  paid_at            TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CHECK (status <> 'paid' OR (reference IS NOT NULL AND paid_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_payout_requests_user   ON payout_requests (user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_payout_requests_status ON payout_requests (status, requested_at);
-- One open request per expert at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_requests_open
  ON payout_requests (user_id) WHERE status IN ('requested', 'approved');

-- ─── Ledger ────────────────────────────────────────────────────────────────

-- A payout request is debited from the wallet once ('Payout' row, ref = request id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_payout_ref
  ON ledger_entries (ref) WHERE type = 'Payout';
-- Wallet queries look up escrow rows by reference (`<contract id>/<milestone id>`).
CREATE INDEX IF NOT EXISTS idx_ledger_ref ON ledger_entries (ref) WHERE ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_payee ON ledger_entries (payee_id) WHERE payee_id IS NOT NULL;
