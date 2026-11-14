-- Google / GitHub sign-in. One row per provider account, linked to one AsteAI account.
-- A provider identity is linked to an existing account only when the provider reports
-- the email as verified (see apps/api/src/modules/auth/oauth/oauth.service.ts).

CREATE TABLE IF NOT EXISTS user_oauth_identities (
  provider          VARCHAR(16)   NOT NULL CHECK (provider IN ('google', 'github')),
  provider_user_id  VARCHAR(255)  NOT NULL,
  user_id           UUID          NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  email             VARCHAR(255)  NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_user_oauth_identities_user ON user_oauth_identities(user_id);
