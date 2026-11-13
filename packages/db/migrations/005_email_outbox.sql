-- Outgoing email, written in the same transaction as whatever caused it and sent by
-- the API's email worker. A row is never lost if the send fails or the process
-- restarts: it is retried with backoff until it is sent or gives up.
--
-- status: pending → sending → sent, or back to pending with next_attempt_at pushed
-- out after a failure, or failed after the last attempt. Workers claim rows with
-- FOR UPDATE SKIP LOCKED, so several API replicas never send the same email twice.
--
-- dedupe_key: optional; a second enqueue with the same key is ignored.

CREATE TABLE IF NOT EXISTS email_outbox (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID          REFERENCES user_accounts(id) ON DELETE SET NULL,
  to_address       VARCHAR(255)  NOT NULL,
  template         VARCHAR(64)   NOT NULL,
  subject          TEXT          NOT NULL,
  html             TEXT          NOT NULL,
  text             TEXT          NOT NULL,
  dedupe_key       VARCHAR(200)  UNIQUE,
  status           VARCHAR(16)   NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts         SMALLINT      NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  claimed_at       TIMESTAMPTZ,
  last_error       TEXT,
  provider_id      TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  sent_at          TIMESTAMPTZ
);

-- The worker's query: due pending rows, oldest first.
CREATE INDEX IF NOT EXISTS idx_email_outbox_due ON email_outbox (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_email_outbox_user ON email_outbox (user_id);
