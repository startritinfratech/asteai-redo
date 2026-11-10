-- Messaging: one-to-one chats between people who work together (buyer ↔ freelancer on a
-- project, employer ↔ candidate who applied to them, anyone ↔ an admin).
--
-- chats.pair_key is "<smaller user id>:<larger user id>" for two-person chats. With the
-- unique index below it stops the same pair getting two chats for the same project (or
-- two direct chats) when both people press "Message" at the same moment.
--
-- chat_members.last_notified_at throttles the in-app "new message" notification to one
-- per chat per member every 10 minutes (claimed with a conditional UPDATE, so several
-- API replicas never double-notify).
--
-- circumvention_logs records messages that looked like an attempt to move the
-- conversation or payment off the platform. The message is still delivered.

CREATE TABLE IF NOT EXISTS chats (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  type             VARCHAR(16)   NOT NULL CHECK (type IN ('direct', 'project', 'support')),
  project_id       VARCHAR(32)   REFERENCES projects(id) ON DELETE SET NULL,
  pair_key         VARCHAR(80),
  created_by       UUID          REFERENCES user_accounts(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- project_id is set for type 'project' (enforced by the API, not a CHECK, so that
  -- deleting a project keeps the conversation with project_id set to NULL).
  last_message_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chats_pair
  ON chats (type, COALESCE(project_id, ''), pair_key)
  WHERE pair_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id           UUID         NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id           UUID         NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  joined_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_read_at      TIMESTAMPTZ,
  last_notified_at  TIMESTAMPTZ,
  PRIMARY KEY (chat_id, user_id)
);

-- "My chats": membership by user, then chats ordered by latest activity.
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members (user_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_chats_last_message ON chats (last_message_at DESC NULLS LAST, created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id     UUID          NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id   UUID          REFERENCES user_accounts(id) ON DELETE SET NULL,
  body        TEXT          NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  edited_at   TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ
);

-- Thread pages (newest first, cursor on created_at) and unread counts.
CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages (chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS circumvention_logs (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID          REFERENCES user_accounts(id) ON DELETE SET NULL,
  chat_id     UUID          REFERENCES chats(id) ON DELETE CASCADE,
  message_id  UUID          REFERENCES messages(id) ON DELETE CASCADE,
  pattern     VARCHAR(32)   NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_circumvention_logs_user ON circumvention_logs (user_id, created_at DESC);
