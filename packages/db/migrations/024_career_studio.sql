-- Candidate Career Studio: Verified Talent Passport, signed credentials, code challenges
-- and AI interview sessions (technical rubric + multilingual railway / trades voice).
--
-- Scores are 0–100 throughout. A competency score is the weighted mean of the best
-- evidence per source item (a challenge, an interview); every change is logged in
-- competency_evidence together with the score and percentile it produced (the telemetry
-- the passport charts). See apps/api/src/modules/passports/scoring.ts.

-- ── Competencies ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS competency_benchmarks (
  key          VARCHAR(40)   PRIMARY KEY,
  label        VARCHAR(80)   NOT NULL,
  category     VARCHAR(10)   NOT NULL CHECK (category IN ('tech', 'trades', 'core')),
  description  TEXT          NOT NULL DEFAULT '',
  sort         SMALLINT      NOT NULL DEFAULT 0
);

INSERT INTO competency_benchmarks (key, label, category, description, sort) VALUES
  ('algorithms',            'Algorithms & data structures', 'tech',   'Correct, efficient solutions to well-specified problems.', 1),
  ('problem_solving',       'Problem solving',               'core',   'Breaks a problem down, weighs options, handles edge cases.', 2),
  ('technical_depth',       'Technical depth',               'tech',   'Understands how and why the tools and systems work.', 3),
  ('system_design',         'System design',                 'tech',   'Designs for scale, failure and change; explains trade-offs.', 4),
  ('communication',         'Communication',                 'core',   'Explains clearly and checks understanding.', 5),
  ('safety_compliance',     'Safety & compliance',           'trades', 'Knows and follows safety rules, permits and reporting.', 6),
  ('procedural_knowledge',  'Procedural knowledge',          'trades', 'Knows the steps of the job and does them in order.', 7),
  ('situational_judgement', 'Situational judgement',         'trades', 'Responds well to faults, emergencies and the unexpected.', 8),
  ('equipment_knowledge',   'Equipment & tools',             'trades', 'Knows the equipment, its checks and its limits.', 9)
ON CONFLICT (key) DO NOTHING;

-- ── Passport ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS talent_passports (
  user_id        UUID          PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  -- Public address: /passports/<slug>. Lowercase, so it never collides with PASS-… ids.
  slug           VARCHAR(40)   NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$'),
  headline       VARCHAR(160)  NOT NULL DEFAULT '',
  visibility     VARCHAR(8)    NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  overall_score  NUMERIC(5,2),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_talent_passports_overall ON talent_passports(overall_score) WHERE overall_score IS NOT NULL;

CREATE TABLE IF NOT EXISTS competency_scores (
  user_id         UUID          NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  competency_key  VARCHAR(40)   NOT NULL REFERENCES competency_benchmarks(key),
  score           NUMERIC(5,2)  NOT NULL CHECK (score BETWEEN 0 AND 100),
  confidence      NUMERIC(3,2)  NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  evidence_count  INTEGER       NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, competency_key)
);
-- Percentiles rank a score among everyone holding that competency.
CREATE INDEX IF NOT EXISTS idx_competency_scores_rank ON competency_scores(competency_key, score);

CREATE TABLE IF NOT EXISTS competency_evidence (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID          NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  competency_key    VARCHAR(40)   NOT NULL REFERENCES competency_benchmarks(key),
  source            VARCHAR(12)   NOT NULL CHECK (source IN ('challenge', 'interview', 'assessment')),
  ref_id            TEXT          NOT NULL,
  score             NUMERIC(5,2)  NOT NULL CHECK (score BETWEEN 0 AND 100),
  -- Telemetry: what this evidence did to the passport.
  score_after       NUMERIC(5,2),
  percentile_after  NUMERIC(5,2),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_competency_evidence_user ON competency_evidence(user_id, competency_key, created_at);

-- ── Signed credentials ──────────────────────────────────────────────────────
-- payload is the exact canonical JSON that was signed (Ed25519, key key_id), so anyone
-- can re-check the signature with the published public key.

CREATE TABLE IF NOT EXISTS credentials (
  code            VARCHAR(20)   PRIMARY KEY,
  user_id         UUID          NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  kind            VARCHAR(20)   NOT NULL CHECK (kind IN ('passport_snapshot', 'challenge', 'interview')),
  payload         TEXT          NOT NULL,
  signature       TEXT          NOT NULL,
  key_id          VARCHAR(40)   NOT NULL,
  issued_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  revoked_reason  VARCHAR(200)
);
CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id, issued_at DESC);

-- ── Code challenges ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS code_challenges (
  id               VARCHAR(60)   PRIMARY KEY,                       -- slug, e.g. 'two-sum'
  title            VARCHAR(120)  NOT NULL,
  prompt           TEXT          NOT NULL,
  difficulty       VARCHAR(6)    NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  competency_key   VARCHAR(40)   NOT NULL REFERENCES competency_benchmarks(key),
  languages        TEXT[]        NOT NULL,
  starter          JSONB         NOT NULL DEFAULT '{}',   -- language → starter code
  examples         JSONB         NOT NULL DEFAULT '[]',   -- shown: [{stdin, expectedOutput}]
  tests            JSONB         NOT NULL DEFAULT '[]',   -- hidden: [{stdin, expectedOutput}]
  time_limit_ms    INTEGER       NOT NULL DEFAULT 2000 CHECK (time_limit_ms BETWEEN 100 AND 15000),
  memory_limit_kb  INTEGER       NOT NULL DEFAULT 131072 CHECK (memory_limit_kb BETWEEN 16384 AND 524288),
  is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
  sort             SMALLINT      NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS challenge_submissions (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge_id    VARCHAR(60)   NOT NULL REFERENCES code_challenges(id),
  user_id         UUID          NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  language        VARCHAR(16)   NOT NULL,
  source          TEXT          NOT NULL CHECK (char_length(source) BETWEEN 1 AND 65536),
  status          VARCHAR(8)    NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'passed', 'failed', 'error')),
  passed_tests    SMALLINT      NOT NULL DEFAULT 0,
  total_tests     SMALLINT      NOT NULL DEFAULT 0,
  score           NUMERIC(5,2),
  max_runtime_ms  INTEGER,
  max_memory_kb   INTEGER,
  -- Client (time to first keystroke, pastes, tab switches…) and runner (per-test status,
  -- time, memory, compile output) telemetry.
  telemetry       JSONB         NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_challenge_submissions_user ON challenge_submissions(user_id, challenge_id, created_at DESC);
-- One submission running per user at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_challenge_submissions_running
  ON challenge_submissions(user_id) WHERE status = 'running';

INSERT INTO code_challenges (id, title, prompt, difficulty, competency_key, languages, starter, examples, tests, sort) VALUES
  ('sum-of-pairs', 'Pairs that sum to a target', E'Read n, then n integers, then a target t.\nPrint how many pairs (i < j) have a[i] + a[j] = t.',
   'easy', 'algorithms', ARRAY['python', 'javascript', 'java', 'cpp', 'go'],
   '{"python": "import sys\n\ndef main():\n    data = sys.stdin.read().split()\n    # your code\n\nmain()\n"}',
   '[{"stdin": "4\n1 2 3 4\n5\n", "expectedOutput": "2"}]',
   '[{"stdin": "4\n1 2 3 4\n5\n", "expectedOutput": "2"}, {"stdin": "5\n1 1 1 1 1\n2\n", "expectedOutput": "10"}, {"stdin": "3\n-1 0 1\n0\n", "expectedOutput": "1"}, {"stdin": "1\n7\n14\n", "expectedOutput": "0"}]',
   1),
  ('balanced-brackets', 'Balanced brackets', E'Read one line of brackets ()[]{}.\nPrint YES if it is balanced, otherwise NO.',
   'medium', 'algorithms', ARRAY['python', 'javascript', 'java', 'cpp', 'go'],
   '{}',
   '[{"stdin": "([]{})\n", "expectedOutput": "YES"}]',
   '[{"stdin": "([]{})\n", "expectedOutput": "YES"}, {"stdin": "([)]\n", "expectedOutput": "NO"}, {"stdin": "((\n", "expectedOutput": "NO"}, {"stdin": "\n", "expectedOutput": "YES"}, {"stdin": "{[()()]}\n", "expectedOutput": "YES"}]',
   2)
ON CONFLICT (id) DO NOTHING;

-- ── AI interview sessions ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS interview_sessions (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            UUID          NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  mode               VARCHAR(12)   NOT NULL CHECK (mode IN ('technical', 'trades_voice')),
  domain             VARCHAR(120)  NOT NULL,
  skill              VARCHAR(120)  NOT NULL,
  frontline_role_id  VARCHAR(80),
  language           VARCHAR(8)    NOT NULL DEFAULT 'en',
  status             VARCHAR(10)   NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  -- [{ role: 'interviewer' | 'candidate', text, at, meta? }]
  transcript         JSONB         NOT NULL DEFAULT '[]',
  question_count     SMALLINT      NOT NULL DEFAULT 0,
  rubric_result      JSONB,
  overall_score      NUMERIC(5,2),
  recommendation     VARCHAR(16),
  credit_spend_id    UUID,
  credential_code    VARCHAR(20)   REFERENCES credentials(code),
  started_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
  completed_at       TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_user ON interview_sessions(user_id, started_at DESC);

-- Starting an AI interview is a metered AI feature (CreditChargeInterceptor).
INSERT INTO credit_costs (feature, label, cost, cost_max, sort) VALUES
  ('ai_interview', 'AI interview session', 10, NULL, 12)
ON CONFLICT (feature) DO NOTHING;
