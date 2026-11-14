/**
 * Runs untrusted code. Never in this process: submissions go to a sandboxed Judge0
 * instance (JUDGE0_URL), which enforces the CPU, wall-clock and memory limits and has no
 * network. Tests replace the runner with a fake.
 */

export const CODE_RUNNER = 'CODE_RUNNER';

export const CHALLENGE_LANGUAGES = ['python', 'javascript', 'java', 'cpp', 'go'] as const;
export type ChallengeLanguage = (typeof CHALLENGE_LANGUAGES)[number];

/** Judge0 CE language ids. */
const JUDGE0_LANGUAGE_ID: Record<ChallengeLanguage, number> = {
  python: 71, // Python 3
  javascript: 63, // Node.js
  java: 62, // OpenJDK
  cpp: 54, // GCC
  go: 60,
};

export type RunStatus = 'ok' | 'compile_error' | 'runtime_error' | 'time_limit' | 'internal_error';

export interface RunInput {
  language: ChallengeLanguage;
  source: string;
  stdin: string;
  timeLimitMs: number;
  memoryLimitKb: number;
}

export interface RunResult {
  status: RunStatus;
  stdout: string;
  /** stderr or compiler output, truncated. */
  diagnostics: string;
  timeMs: number | null;
  memoryKb: number | null;
}

export interface CodeRunner {
  run(input: RunInput): Promise<RunResult>;
}

const OUTPUT_CAP = 64 * 1024;
const DIAGNOSTICS_CAP = 4 * 1024;

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s: unknown, cap: number) =>
  (typeof s === 'string' ? Buffer.from(s, 'base64').toString('utf8') : '').slice(0, cap);

/** Judge0 status ids → our statuses (https://ce.judge0.com/statuses). */
export function judge0Status(id: number): RunStatus {
  if (id === 3 || id === 4) return 'ok'; // Accepted / Wrong Answer (we compare output ourselves)
  if (id === 5) return 'time_limit';
  if (id === 6) return 'compile_error';
  if (id >= 7 && id <= 12) return 'runtime_error'; // SIGSEGV, SIGXFSZ, SIGFPE, SIGABRT, NZEC, other
  return 'internal_error'; // 1–2 still queued/processing, 13 internal error, 14 exec format error
}

export class Judge0Runner implements CodeRunner {
  constructor(
    private readonly baseUrl: string,
    private readonly authToken?: string,
    private readonly http: typeof fetch = fetch,
  ) {}

  async run(input: RunInput): Promise<RunResult> {
    const seconds = input.timeLimitMs / 1000;
    let res: Response;
    try {
      res = await this.http(`${this.baseUrl.replace(/\/$/, '')}/submissions?base64_encoded=true&wait=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.authToken ? { 'X-Auth-Token': this.authToken } : {}),
        },
        body: JSON.stringify({
          language_id: JUDGE0_LANGUAGE_ID[input.language],
          source_code: b64(input.source),
          stdin: b64(input.stdin),
          cpu_time_limit: seconds,
          wall_time_limit: Math.max(seconds * 3, 5),
          memory_limit: input.memoryLimitKb,
          enable_network: false,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return { status: 'internal_error', stdout: '', diagnostics: 'runner unreachable', timeMs: null, memoryKb: null };
    }
    if (!res.ok) {
      return { status: 'internal_error', stdout: '', diagnostics: `runner HTTP ${res.status}`, timeMs: null, memoryKb: null };
    }
    const body = (await res.json().catch(() => null)) as {
      status?: { id?: number }; stdout?: string; stderr?: string; compile_output?: string; time?: string | null; memory?: number | null;
    } | null;
    const status = judge0Status(Number(body?.status?.id));
    return {
      status,
      stdout: unb64(body?.stdout, OUTPUT_CAP),
      diagnostics: unb64(status === 'compile_error' ? body?.compile_output : body?.stderr, DIAGNOSTICS_CAP),
      timeMs: body?.time ? Math.round(Number(body.time) * 1000) : null,
      memoryKb: typeof body?.memory === 'number' ? body.memory : null,
    };
  }
}
