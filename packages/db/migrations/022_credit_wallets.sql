-- AI credits: one wallet per user plus an append-only ledger of credit lots and spends.
--
-- credit_transactions rows are of two kinds:
--   lots    type grant | topup | refund, amount > 0. remaining_amount is what is still
--           unspent; spends draw it down oldest lot first (FIFO). A lot past expires_at is
--           zeroed (status 'expired') the next time the wallet is touched.
--   spends  type spend, amount < 0, remaining_amount 0. metadata.allocations records which
--           lots paid for it, so a refund (AI task failed) puts credits back in those lots.
-- status: pending (top-up awaiting payment) | completed | refunded (spend given back)
--         | expired (lot ran out of time) | failed (payment never arrived).
--
-- wallets.balance is the sum of remaining_amount over live lots, kept in step inside the
-- same transaction as every change (CreditsService), with the wallet row locked FOR UPDATE.

CREATE TABLE IF NOT EXISTS wallets (
  user_id                  UUID          PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  balance                  INTEGER       NOT NULL DEFAULT 0 CHECK (balance >= 0),
  subscription_tier        VARCHAR(12)   NOT NULL DEFAULT 'free'
                                         CHECK (subscription_tier IN ('free', 'pro', 'enterprise')),
  subscription_status      VARCHAR(16)   CHECK (subscription_status IN
                                         ('created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed')),
  razorpay_subscription_id TEXT          UNIQUE,
  current_period_end       TIMESTAMPTZ,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID          NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  type              VARCHAR(8)    NOT NULL CHECK (type IN ('grant', 'topup', 'spend', 'refund')),
  amount            INTEGER       NOT NULL CHECK (amount <> 0),
  remaining_amount  INTEGER       NOT NULL DEFAULT 0 CHECK (remaining_amount >= 0),
  expires_at        TIMESTAMPTZ,
  feature_key       VARCHAR(40),
  status            VARCHAR(10)   NOT NULL DEFAULT 'completed'
                                  CHECK (status IN ('pending', 'completed', 'refunded', 'expired', 'failed')),
  -- Idempotency key from outside: Razorpay order / payment id, or the refunded spend's id.
  reference         TEXT,
  metadata          JSONB         NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CHECK ((type = 'spend') = (amount < 0)),
  CHECK (remaining_amount <= GREATEST(amount, 0))
);

-- FIFO scan of a user's live lots.
CREATE INDEX IF NOT EXISTS idx_credit_tx_lots
  ON credit_transactions(user_id, created_at, id)
  WHERE remaining_amount > 0;
CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id, created_at DESC);
-- One ledger row per external event (a payment is never credited twice, a spend never refunded twice).
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_tx_reference
  ON credit_transactions(type, reference) WHERE reference IS NOT NULL;

-- Top-up packs offered at checkout (prices in paise). Placeholder prices: confirm before launch.
INSERT INTO platform_settings (key, value) VALUES
  ('credit_packs', '[{"id":"starter","credits":50,"priceMinor":4900},{"id":"standard","credits":120,"priceMinor":9900},{"id":"bulk","credits":650,"priceMinor":49900}]')
ON CONFLICT (key) DO NOTHING;
