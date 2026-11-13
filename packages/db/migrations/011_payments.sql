-- Payments core (Razorpay): checkout orders, webhook events and refunds.
--
--   payment_orders   one row per provider order opened for something we charge for
--                    (purpose 'escrow_milestone': an escrow_payments row). Opened after the
--                    escrow payment row is committed, never inside the transaction that holds
--                    the contract locks. At most one open order (created / attempted) per
--                    escrow payment, so a repeated or concurrent "fund" reuses it.
--   payment_events   every verified webhook delivery, keyed by Razorpay's X-Razorpay-Event-Id.
--                    Inserted before it is handled (ON CONFLICT DO NOTHING), so a redelivery
--                    of a processed event is answered without running it again. The payload
--                    is stored with personal data (email, phone, card, VPA, bank) removed.
--   refunds          money sent back to the buyer of a cancelled contract against one of its
--                    captured escrow payments. 'pending' rows reserve contracts.refund_due so
--                    two admins cannot refund the same money; 'processed' (provider webhook)
--                    writes the 'Refund' ledger row and lowers contracts.refund_due, once per
--                    provider_refund_id.
--
-- Amounts: payment_orders.amount_minor is what the provider charges (paise); escrow and
-- refunds use NUMERIC(12,2) like the rest of the contract accounting.

CREATE TABLE IF NOT EXISTS payment_orders (
  id                 UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  purpose            VARCHAR(32)    NOT NULL CHECK (purpose IN ('escrow_milestone')),
  escrow_payment_id  UUID           REFERENCES escrow_payments(id),
  user_id            UUID           NOT NULL REFERENCES user_accounts(id),
  amount_minor       BIGINT         NOT NULL CHECK (amount_minor > 0),
  currency           CHAR(3)        NOT NULL,
  provider           VARCHAR(16)    NOT NULL DEFAULT 'razorpay' CHECK (provider IN ('razorpay')),
  provider_order_id  TEXT           NOT NULL UNIQUE,
  status             VARCHAR(16)    NOT NULL DEFAULT 'created'
                     CHECK (status IN ('created', 'attempted', 'paid', 'failed', 'expired', 'unapplied', 'refunded')),
  receipt            VARCHAR(40),
  provider_payment_id TEXT,
  -- Last failed checkout attempt (a failure does not close the order; the buyer can retry).
  last_error         TEXT,
  -- 'unapplied': Razorpay received the payment but it could not be applied (e.g. the contract
  -- was cancelled). An admin refunds it (refunded_at is the claim, refund_provider_id the result).
  unapplied_reason   TEXT,
  unapplied_amount_minor BIGINT,
  refunded_at        TIMESTAMPTZ,
  refund_provider_id TEXT,
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CHECK (purpose <> 'escrow_milestone' OR escrow_payment_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_escrow ON payment_orders (escrow_payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user   ON payment_orders (user_id, created_at DESC);
-- One open order per escrow payment: the loser of a concurrent "fund" reuses the winner's.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_orders_open
  ON payment_orders (escrow_payment_id) WHERE status IN ('created', 'attempted');

-- The latest provider order opened for an escrow payment (payment_orders holds them all).
ALTER TABLE escrow_payments ADD COLUMN IF NOT EXISTS provider_order_id TEXT;

CREATE TABLE IF NOT EXISTS payment_events (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider      VARCHAR(16)   NOT NULL DEFAULT 'razorpay',
  event_id      TEXT          NOT NULL UNIQUE,
  event_type    VARCHAR(64)   NOT NULL,
  payload       JSONB         NOT NULL DEFAULT '{}',
  received_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- Set once handled (or once refused for a business reason, with `error` saying why).
  -- NULL with an error: the handler crashed and the provider's retry will run it again.
  processed_at  TIMESTAMPTZ,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_events_unprocessed
  ON payment_events (received_at) WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS refunds (
  id                  UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id         VARCHAR(32)    NOT NULL REFERENCES contracts(id),
  escrow_payment_id   UUID           NOT NULL REFERENCES escrow_payments(id),
  amount              NUMERIC(12,2)  NOT NULL CHECK (amount > 0),
  currency            CHAR(3)        NOT NULL,
  provider            VARCHAR(16)    NOT NULL DEFAULT 'razorpay',
  -- NULL until the provider accepts the request. Still NULL on a 'pending' row: the
  -- request's outcome is unknown (timeout); the refund webhook matches it by notes.refundId.
  provider_refund_id  TEXT           UNIQUE,
  status              VARCHAR(16)    NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processed', 'failed')),
  reason              TEXT           NOT NULL,
  error               TEXT,
  requested_by        UUID           REFERENCES user_accounts(id),
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  processed_at        TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refunds_contract ON refunds (contract_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refunds_payment  ON refunds (escrow_payment_id);
