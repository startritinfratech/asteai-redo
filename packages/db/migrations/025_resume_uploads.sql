-- Résumé uploads (browser → S3 via presigned PUT) and the AI autofill draft made from
-- them. The file itself lives in S3 under object_key; nothing here is the file.

CREATE TABLE IF NOT EXISTS resume_uploads (
  id           UUID          PRIMARY KEY,
  user_id      UUID          NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  object_key   TEXT          NOT NULL UNIQUE,
  kind         VARCHAR(4)    NOT NULL CHECK (kind IN ('pdf', 'docx')),
  file_name    VARCHAR(200)  NOT NULL,
  size_bytes   INTEGER       NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  status       VARCHAR(8)    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'parsed', 'rejected')),
  autofill     JSONB,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  parsed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_resume_uploads_user ON resume_uploads(user_id, created_at DESC);
