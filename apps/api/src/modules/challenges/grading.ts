/** Pure grading helpers for code challenges (grading.spec.ts). */
import type { RunResult, RunStatus } from './code-runner';

export interface TestCase {
  stdin: string;
  expectedOutput: string;
}

export interface TestOutcome {
  index: number;
  passed: boolean;
  status: RunStatus | 'wrong_answer' | 'skipped';
  timeMs: number | null;
  memoryKb: number | null;
}

/** Output matches ignoring trailing spaces on each line and trailing blank lines (and CRLF). */
export function outputsMatch(expected: string, actual: string): boolean {
  const norm = (s: string) => s.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n+$/, '');
  return norm(expected) === norm(actual);
}

export function outcomeOf(index: number, test: TestCase, run: RunResult): TestOutcome {
  const passed = run.status === 'ok' && outputsMatch(test.expectedOutput, run.stdout);
  return {
    index,
    passed,
    status: run.status === 'ok' && !passed ? 'wrong_answer' : run.status,
    timeMs: run.timeMs,
    memoryKb: run.memoryKb,
  };
}

export interface Grade {
  status: 'passed' | 'failed';
  passedTests: number;
  totalTests: number;
  /** 0–100, proportional to tests passed. */
  score: number;
  maxRuntimeMs: number | null;
  maxMemoryKb: number | null;
}

export function grade(outcomes: readonly TestOutcome[], totalTests: number): Grade {
  const passedTests = outcomes.filter((o) => o.passed).length;
  const max = (xs: (number | null)[]) => {
    const vals = xs.filter((x): x is number => x !== null);
    return vals.length ? Math.max(...vals) : null;
  };
  return {
    status: totalTests > 0 && passedTests === totalTests ? 'passed' : 'failed',
    passedTests,
    totalTests,
    score: totalTests ? Math.round((passedTests / totalTests) * 10_000) / 100 : 0,
    maxRuntimeMs: max(outcomes.map((o) => o.timeMs)),
    maxMemoryKb: max(outcomes.map((o) => o.memoryKb)),
  };
}

const CLIENT_TELEMETRY_FIELDS = [
  'durationMs', 'timeToFirstKeystrokeMs', 'keystrokes', 'pasteCount', 'pastedChars', 'tabSwitches', 'runCount',
] as const;
export type ClientTelemetry = Partial<Record<(typeof CLIENT_TELEMETRY_FIELDS)[number], number>>;

/**
 * Keeps only the known numeric fields, as non-negative integers within sane bounds. It is
 * self-reported, so it is stored for review and never affects the score.
 */
export function sanitizeTelemetry(raw: unknown): ClientTelemetry {
  const out: ClientTelemetry = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of CLIENT_TELEMETRY_FIELDS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = Math.min(Math.floor(v), 86_400_000);
  }
  return out;
}
