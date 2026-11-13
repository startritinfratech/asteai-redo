-- One-time codes sent by email: the first step of sign-up (prove the address before the
-- account exists). Only an HMAC of the 6-digit code (keyed with the server secret and the
-- row id) is stored.
--
-- A code expires after 10 minutes and allows 5 attempts. Verifying it sets consumed_at and
-- returns a short-lived signed ticket that POST /auth/register accepts; an account created
-- with a ticket starts with email_verified = TRUE. Sending a new code for the same email
-- and purpose consumes any older unused one.

CREATE TABLE IF NOT EXISTS email_otps (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(254)  NOT NULL,
  purpose       VARCHAR(16)   NOT NULL CHECK (purpose IN ('register')),
  code_hash     TEXT          NOT NULL,
  attempts      SMALLINT      NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ   NOT NULL,
  consumed_at   TIMESTAMPTZ,
  ip            INET,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_otps_lookup ON email_otps(LOWER(email), purpose, created_at DESC);
