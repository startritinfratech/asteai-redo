import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadGatewayException, BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { fakeDb, type Route } from '../../test-support/fakes';
import type { CredentialsService } from '../credentials/credentials.service';
import type { TalentPassportService } from '../passports/talent-passport.service';
import { ChallengesService, SUBMISSIONS_PER_HOUR } from './challenges.service';
import { Judge0Runner, judge0Status, type CodeRunner, type RunInput, type RunResult } from './code-runner';
import { grade, outcomeOf, outputsMatch, sanitizeTelemetry } from './grading';

describe('grading', () => {
  it('compares output ignoring trailing whitespace, blank lines and CRLF only', () => {
    assert.equal(outputsMatch('2', '2\n'), true);
    assert.equal(outputsMatch('a b\nc', 'a b  \r\nc\r\n\n'), true);
    assert.equal(outputsMatch('2', ' 2'), false);
    assert.equal(outputsMatch('YES', 'yes'), false);
  });

  it('scores proportionally and passes only when every test passes', () => {
    const ok = (stdout: string): RunResult => ({ status: 'ok', stdout, diagnostics: '', timeMs: 12, memoryKb: 900 });
    const t = { stdin: '', expectedOutput: '2' };
    const outcomes = [outcomeOf(0, t, ok('2')), outcomeOf(1, t, ok('3')), outcomeOf(2, t, { ...ok(''), status: 'time_limit', timeMs: 2000 })];
    assert.deepEqual(outcomes.map((o) => o.status), ['ok', 'wrong_answer', 'time_limit']);
    assert.deepEqual(grade(outcomes, 4), { status: 'failed', passedTests: 1, totalTests: 4, score: 25, maxRuntimeMs: 2000, maxMemoryKb: 900 });
    assert.equal(grade([outcomeOf(0, t, ok('2'))], 1).status, 'passed');
  });

  it('keeps only known, bounded telemetry numbers', () => {
    assert.deepEqual(sanitizeTelemetry({ pasteCount: 2.7, tabSwitches: -1, durationMs: 1e12, evil: '<script>', runCount: '3' }),
      { pasteCount: 2, durationMs: 86_400_000 });
    assert.deepEqual(sanitizeTelemetry('nope'), {});
  });
});

describe('Judge0Runner', () => {
  it('maps Judge0 statuses', () => {
    assert.deepEqual([3, 4, 5, 6, 7, 11, 13, 1].map(judge0Status),
      ['ok', 'ok', 'time_limit', 'compile_error', 'runtime_error', 'runtime_error', 'internal_error', 'internal_error']);
  });

  it('sends base64 source with the limits and no network, and decodes the result', async () => {
    let sent: Record<string, unknown> = {};
    const http = (async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ status: { id: 3 }, stdout: Buffer.from('2\n').toString('base64'), time: '0.015', memory: 3200 }));
    }) as typeof fetch;
    const out = await new Judge0Runner('http://judge0:2358', 'tok', http).run({
      language: 'python', source: 'print(2)', stdin: '1 1', timeLimitMs: 2000, memoryLimitKb: 131072,
    });
    assert.equal(sent.language_id, 71);
    assert.equal(Buffer.from(String(sent.source_code), 'base64').toString(), 'print(2)');
    assert.equal(sent.cpu_time_limit, 2);
    assert.equal(sent.enable_network, false);
    assert.deepEqual(out, { status: 'ok', stdout: '2\n', diagnostics: '', timeMs: 15, memoryKb: 3200 });
  });

  it('reports an unreachable runner as internal_error, not as a failed test', async () => {
    const http = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    assert.equal((await new Judge0Runner('http://x', undefined, http).run({
      language: 'go', source: 'x', stdin: '', timeLimitMs: 1000, memoryLimitKb: 65536,
    })).status, 'internal_error');
  });
});

// ── ChallengesService.submit ─────────────────────────────────────────────────

const CHALLENGE = {
  id: 'sum-of-pairs', title: 'Pairs that sum to a target', prompt: '…', difficulty: 'easy', competency_key: 'algorithms',
  languages: ['python', 'javascript'], starter: {}, examples: [{ stdin: 'e', expectedOutput: '1' }],
  tests: [{ stdin: 'e', expectedOutput: '1' }, { stdin: 'h1', expectedOutput: '10' }, { stdin: 'h2', expectedOutput: '0' }],
  time_limit_ms: 2000, memory_limit_kb: 131072,
};

/** Answers each test's stdin from `answers`; a function can fake compile errors etc. */
function fakeRunner(answers: Record<string, string> | ((i: RunInput) => RunResult)) {
  const calls: RunInput[] = [];
  const runner: CodeRunner = {
    run: async (input) => {
      calls.push(input);
      if (typeof answers === 'function') return answers(input);
      return { status: 'ok', stdout: answers[input.stdin] ?? '', diagnostics: '', timeMs: 10, memoryKb: 1000 };
    },
  };
  return { runner, calls };
}

function setup(opts: { recent?: number; running?: boolean; earlierPass?: boolean; runner?: CodeRunner } = {}) {
  const routes: Route[] = [
    [/FROM code_challenges WHERE id = \$1 AND is_active/, [CHALLENGE]],
    [/SELECT COUNT\(\*\)::int AS n FROM challenge_submissions/, [{ n: opts.recent ?? 0 }]],
    [/^INSERT INTO challenge_submissions/, () => (opts.running ? { error: Object.assign(new Error('dup'), { code: '23505' }) } : [{ id: 'sub-1' }])],
    [/status = 'passed' AND id <> \$3/, opts.earlierPass ? [{}] : []],
  ];
  const db = fakeDb(routes);
  const evidence: unknown[] = [];
  const passports = {
    recordEvidence: async (_u: string, items: { competencyKey: string; score: number }[]) => {
      evidence.push(...items);
      return { overallScore: items[0].score, competencies: [{ key: items[0].competencyKey, score: items[0].score, percentile: 50 }] };
    },
  } as unknown as TalentPassportService;
  const issued: Record<string, unknown>[] = [];
  const credentials = {
    issue: async (_u: string, kind: string, subject: Record<string, unknown>) => {
      issued.push({ kind, ...subject });
      return { code: 'AST-2222-3333-4444', kind, issuedAt: '', expiresAt: null, verifyPath: '/verify/AST-2222-3333-4444' };
    },
  } as unknown as CredentialsService;
  const runner = opts.runner ?? fakeRunner({ e: '1\n', h1: '10', h2: '0' }).runner;
  return { svc: new ChallengesService(db.pool, passports, credentials, runner), db, evidence, issued };
}

describe('ChallengesService.submit', () => {
  const input = { language: 'python', source: 'print(...)', telemetry: { pasteCount: 1, junk: 'x' } };

  it('a full pass: graded, stored, passport updated, credential issued on the first pass', async () => {
    const { svc, db, evidence, issued } = setup();
    const out = await svc.submit('u1', 'sum-of-pairs', input);
    assert.equal(out.status, 'passed');
    assert.equal(out.score, 100);
    assert.deepEqual(out.tests.map((t) => t.example), [true, false, false]);
    assert.deepEqual(evidence, [{ competencyKey: 'algorithms', source: 'challenge', refId: 'sum-of-pairs', score: 100 }]);
    assert.deepEqual(out.passport, { competency: 'algorithms', score: 100, percentile: 50 });
    assert.equal(issued[0].kind, 'challenge');
    assert.equal(out.credential?.code, 'AST-2222-3333-4444');
    const [insert] = db.all(/^INSERT INTO challenge_submissions/);
    assert.equal(insert.params[5], JSON.stringify({ client: { pasteCount: 1 } }), 'telemetry is sanitised');
    assert.deepEqual(db.tx(), ['BEGIN', 'COMMIT']);
    assert.equal(JSON.stringify(out).includes('h1'), false, 'hidden test input never leaves the API');
  });

  it('a partial pass scores proportionally and issues no credential', async () => {
    const { svc, issued } = setup({ runner: fakeRunner({ e: '1', h1: '9', h2: '0' }).runner });
    const out = await svc.submit('u1', 'sum-of-pairs', input);
    assert.equal(out.status, 'failed');
    assert.equal(out.score, 66.67);
    assert.equal(out.credential, null);
    assert.equal(issued.length, 0);
  });

  it('no second credential for a challenge already passed', async () => {
    const { svc, issued } = setup({ earlierPass: true });
    assert.equal((await svc.submit('u1', 'sum-of-pairs', input)).credential, null);
    assert.equal(issued.length, 0);
  });

  it('a compile error stops after the first test and returns the compiler output', async () => {
    const { runner, calls } = fakeRunner(() => ({ status: 'compile_error', stdout: '', diagnostics: 'SyntaxError', timeMs: null, memoryKb: null }));
    const { svc } = setup({ runner });
    const out = await svc.submit('u1', 'sum-of-pairs', input);
    assert.equal(calls.length, 1);
    assert.equal(out.compileOutput, 'SyntaxError');
    assert.deepEqual(out.tests.map((t) => t.status), ['compile_error', 'skipped', 'skipped']);
    assert.equal(out.score, 0);
  });

  it('a runner outage is a 502 and the attempt is marked error, with no passport change', async () => {
    const { svc, db, evidence } = setup({ runner: fakeRunner(() => ({ status: 'internal_error', stdout: '', diagnostics: '', timeMs: null, memoryKb: null })).runner });
    await assert.rejects(svc.submit('u1', 'sum-of-pairs', input), BadGatewayException);
    assert.ok(db.all(/SET status = 'error'/).some((q) => q.params[0] === 'sub-1'));
    assert.equal(evidence.length, 0);
  });

  it('rate limits: 429 past the hourly cap, 409 while another submission runs', async () => {
    await assert.rejects(setup({ recent: SUBMISSIONS_PER_HOUR }).svc.submit('u1', 'sum-of-pairs', input),
      (err: unknown) => err instanceof HttpException && err.getStatus() === 429);
    await assert.rejects(setup({ running: true }).svc.submit('u1', 'sum-of-pairs', input), ConflictException);
  });

  it('refuses a language the challenge does not accept, before running anything', async () => {
    const { runner, calls } = fakeRunner({});
    await assert.rejects(setup({ runner }).svc.submit('u1', 'sum-of-pairs', { ...input, language: 'go' }), BadRequestException);
    assert.equal(calls.length, 0);
  });
});
