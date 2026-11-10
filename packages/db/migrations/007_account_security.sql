-- Account security: password reset and email verification tokens, TOTP two-factor
-- authentication with backup codes, session metadata on refresh tokens, and the
-- columns soft deletion and "sign out other sessions on password change" rely on.
--
-- auth_tokens: single-use links sent by email. Only the SHA-256 of the token is stored;
-- the raw token exists only in the email. A token is consumed by setting used_at with a
-- conditional UPDATE, so two concurrent uses cannot both succeed.
--
-- user_totp: the TOTP secret is stored AES-256-GCM encrypted (key from
-- TOTP_ENCRYPTION_KEY). last_used_step blocks replaying a code inside its window;
-- failed_attempts / locked_until lock code entry for 15 minutes after 5 failures.
--
-- user_totp_backup_codes: one-time recovery codes, stored as SHA-256 hashes.

CREATE TABLE IF NOT EXISTS auth_tokens (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID         NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  purpose     VARCHAR(32)  NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash  TEXT         NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_purpose ON auth_tokens(user_id, purpose);

CREATE TABLE IF NOT EXISTS user_totp (
  user_id           UUID         PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  secret_encrypted  TEXT         NOT NULL,
  enabled           BOOLEAN      NOT NULL DEFAULT FALSE,
  enrolled_at       TIMESTAMPTZ,
  last_used_step    BIGINT,
  failed_attempts   INT          NOT NULL DEFAULT 0,
  locked_until      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_totp_backup_codes (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID         NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  code_hash   TEXT         NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, code_hash)
);

-- deleted_at already exists in 001; kept here so the migration also works on older copies.
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Refresh tokens rotate on every refresh (one row per use), so a "session" is the chain
-- of rows. session_started_at is carried from row to row: it is when the user signed in
-- on that device; the row's created_at is when the session was last refreshed.
-- user_agent and ip_address already exist in 001.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS session_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active ON refresh_tokens(user_id) WHERE revoked = FALSE;
