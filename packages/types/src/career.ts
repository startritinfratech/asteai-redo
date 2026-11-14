// ─── Candidate Career Studio ─────────────────────────────────────────────────
// JSON contract of /passports/*, /verify/*, /challenges/*, /interviews/{start,…} and
// /resumes/*, shared by apps/api and the web app.

// ── Credentials ──

export type CredentialKind = 'passport_snapshot' | 'challenge' | 'interview';

export interface IssuedCredential {
  code: string;
  kind: CredentialKind;
  issuedAt: string;
  expiresAt: string | null;
  verifyPath: string;
}

export interface CredentialJwk { kty: 'OKP'; crv: 'Ed25519'; x: string; kid: string; alg: 'EdDSA'; use: 'sig' }

/** GET /verify/:code */
export type VerificationResult =
  | {
    valid: true;
    code: string;
    kind: CredentialKind;
    claims: Record<string, unknown>;
    proof: { alg: 'EdDSA'; keyId: string; payload: string; signature: string; publicKey: CredentialJwk | null };
    verifiedAt: string;
  }
  | { valid: false; code: string | null; reason: 'not_found' | 'revoked' | 'expired' | 'bad_signature' | 'unavailable' };

// ── Talent Passport ──

export type CompetencyCategory = 'tech' | 'trades' | 'core';

export interface CompetencyView {
  key: string;
  label: string;
  category: CompetencyCategory;
  score: number;
  confidence: number;
  evidenceCount: number;
  /** Rank among everyone holding this competency, 0–100; null when nobody else has it yet. */
  percentile: number | null;
  /** Score / percentile after each recent piece of evidence, oldest first (up to 12). */
  trend: { at: string; score: number; percentile: number | null }[];
  updatedAt: string;
}

/** GET /passports/:slug and /passports/me/profile */
export interface PassportProfile {
  slug: string;
  holderName: string;
  headline: string;
  visibility: 'public' | 'private';
  overall: { score: number | null; percentile: number | null };
  competencies: CompetencyView[];
  credentials: { code: string; kind: CredentialKind; issuedAt: string; verifyPath: string }[];
  updatedAt: string;
}

export interface CompetencyBenchmark {
  key: string;
  label: string;
  category: CompetencyCategory;
  description: string;
  holders: number;
  meanScore: number | null;
  medianScore: number | null;
  p90Score: number | null;
}

// ── Code challenges ──

export const CHALLENGE_LANGUAGES = ['python', 'javascript', 'java', 'cpp', 'go'] as const;
export type ChallengeLanguage = (typeof CHALLENGE_LANGUAGES)[number];
export type ChallengeDifficulty = 'easy' | 'medium' | 'hard';

export interface ChallengeSummary {
  id: string;
  title: string;
  difficulty: ChallengeDifficulty;
  competency: string;
  languages: ChallengeLanguage[];
  testCount: number;
  bestScore: number | null;
}

export interface ChallengeDetail {
  id: string;
  title: string;
  prompt: string;
  difficulty: ChallengeDifficulty;
  competency: string;
  languages: ChallengeLanguage[];
  starter: Partial<Record<ChallengeLanguage, string>>;
  examples: { stdin: string; expectedOutput: string }[];
  testCount: number;
  timeLimitMs: number;
  memoryLimitKb: number;
}

export type TestStatus = 'ok' | 'compile_error' | 'runtime_error' | 'time_limit' | 'internal_error' | 'wrong_answer' | 'skipped';

export interface SubmissionResult {
  submissionId: string;
  status: 'passed' | 'failed';
  passedTests: number;
  totalTests: number;
  score: number;
  maxRuntimeMs: number | null;
  maxMemoryKb: number | null;
  /** Pass/fail per test. No test's input or output is returned (hidden tests stay hidden). */
  tests: { index: number; passed: boolean; status: TestStatus; timeMs: number | null; memoryKb: number | null; example: boolean }[];
  compileOutput: string | null;
  passport: { competency: string; score: number; percentile: number | null } | null;
  /** Issued on the first full pass of a challenge. */
  credential: IssuedCredential | null;
}

/** Editor telemetry sent with a submission; stored for review, never scored. */
export interface ChallengeTelemetry {
  durationMs?: number;
  timeToFirstKeystrokeMs?: number;
  keystrokes?: number;
  pasteCount?: number;
  pastedChars?: number;
  tabSwitches?: number;
  runCount?: number;
}

// ── AI Interview Studio ──

export type StudioMode = 'technical' | 'trades_voice';
export type StudioRecommendation = 'strong' | 'ready' | 'developing' | 'not_ready';

/** POST /interviews/start and /interviews/:id/turn */
export interface StudioTurnResponse {
  sessionId: string;
  mode: StudioMode;
  language: string;
  status: 'active';
  questionNumber: number;
  maxQuestions: number;
  answersGiven: number;
  /** The next question, or null once the last answer is in (then call /complete). */
  prompt: { text: string; language: string; speak: boolean } | null;
  canComplete: boolean;
}

export interface StudioCriterionResult {
  key: string;
  label: string;
  weight: number;
  /** 1–5 against the rubric anchors. */
  score: number;
  /** The same on 0–100. */
  normalized: number;
  evidence: string;
  competency: string;
}

export interface StudioRubricResult {
  criteria: StudioCriterionResult[];
  overall: number;
  recommendation: StudioRecommendation;
  gatesFailed: string[];
  summary: string;
  strengths: string[];
  improvements: string[];
}

/** POST /interviews/:id/complete */
export interface StudioCompletion {
  sessionId: string;
  status: 'completed';
  mode: StudioMode;
  rubric: StudioRubricResult;
  passport: { competencies: { key: string; score: number; percentile: number | null }[]; overallScore: number | null } | null;
  credential: IssuedCredential | null;
}

// ── Résumé upload & AI autofill ──

export const RESUME_MAX_BYTES = 5 * 1024 * 1024;
export const RESUME_MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

/** POST /resumes/upload-url: PUT the file to `url` with exactly these headers. */
export interface ResumeUploadTicket {
  uploadId: string;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/** POST /resumes/:id/autofill: a draft for the user to review, never saved automatically. */
export interface ResumeDraft {
  fullName: string;
  headline: string;
  summary: string;
  location: string;
  yearsExperience: number | null;
  skills: string[];
  domains: string[];
  languages: string[];
  links: { linkedinUrl: string; githubUrl: string; portfolioUrl: string };
  experience: { title: string; organization: string; start: string; end: string; highlights: string[] }[];
  education: { qualification: string; institution: string; year: string }[];
}

export interface ResumeAutofillResult {
  uploadId: string;
  fileKind: 'pdf' | 'docx';
  draft: ResumeDraft;
}
