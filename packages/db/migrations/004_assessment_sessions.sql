-- Role-fit assessments are now scored by deeptech_ai, not the browser.
--
-- assessment_sessions: one live session per candidate per requisition. Starting again
-- resumes the same session, so a candidate can't open several and keep the best one.
-- The id is deeptech_ai's session id. An admin can reset an expired or stuck session
-- (with a reason, audited); the row stays as history with status 'reset' and the
-- candidate can start a new one.
--
-- assessment_results.session_id: the session a result came from. Unique, so storing a
-- finished session twice (a retried request) keeps one result. NULL for results that
-- were posted by the browser before this change.

CREATE TABLE IF NOT EXISTS assessment_sessions (
  id              VARCHAR(64)   PRIMARY KEY,
  candidate_id    UUID          NOT NULL REFERENCES user_accounts(id),
  requisition_id  VARCHAR(32)   NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  status          VARCHAR(16)   NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'completed', 'expired', 'reset')),
  result_id       VARCHAR(32)   REFERENCES assessment_results(id),
  started_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  reset_by        UUID          REFERENCES user_accounts(id),
  reset_reason    TEXT,
  reset_at        TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_sessions_live
  ON assessment_sessions (candidate_id, requisition_id) WHERE status <> 'reset';
CREATE INDEX IF NOT EXISTS idx_assessment_sessions_status ON assessment_sessions (status, started_at DESC);

ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS session_id VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_results_session ON assessment_results (session_id);
