-- Help desk: signed-in users open tickets in a category; support staff (Admin) reply.
-- status: open → pending_user (staff replied, waiting on the user) → open (user replied)
-- … → resolved. A user reply on a resolved ticket reopens it.

CREATE TABLE IF NOT EXISTS support_categories (
  id    VARCHAR(40)  PRIMARY KEY,
  name  VARCHAR(80)  NOT NULL,
  sort  SMALLINT     NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id           VARCHAR(32)   PRIMARY KEY,                                  -- 'TKT-…'
  user_id      UUID          NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  category_id  VARCHAR(40)   NOT NULL REFERENCES support_categories(id),
  subject      VARCHAR(200)  NOT NULL,
  status       VARCHAR(14)   NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open', 'pending_user', 'resolved')),
  assignee_id  UUID          REFERENCES user_accounts(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id   VARCHAR(32)  NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   UUID         NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  from_staff  BOOLEAN      NOT NULL DEFAULT FALSE,
  body        TEXT         NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id, created_at);

INSERT INTO support_categories (id, name, sort) VALUES
  ('account',     'Account & sign-in',          1),
  ('billing',     'Billing, credits & payouts', 2),
  ('hiring',      'Hiring & requisitions',      3),
  ('assessments', 'Assessments & interviews',   4),
  ('projects',    'Projects, gigs & contracts', 5),
  ('other',       'Something else',             6)
ON CONFLICT (id) DO NOTHING;
