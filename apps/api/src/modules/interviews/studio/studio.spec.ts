import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BadGatewayException, BadRequestException, ConflictException, ForbiddenException, GoneException,
} from '@nestjs/common';
import { fakeDb, type Route } from '../../../test-support/fakes';
import type { CredentialsService } from '../../credentials/credentials.service';
import type { TalentPassportService } from '../../passports/talent-passport.service';
import type { InterviewContext, InterviewModel, ModelAssessment, TranscriptTurn } from './interview-model';
import { RUBRICS } from './rubrics';
import { InvalidModelScoresError, recommendationFor, scoreRubric } from './scoring';
import { StudioService } from './studio.service';

const all = (mode: 'technical' | 'trades_voice', score: number) =>
  RUBRICS[mode].criteria.map((c) => ({ key: c.key, score, evidence: `said something about ${c.key}` }));

describe('rubrics', () => {
  it('weights of every rubric sum to 1, and every criterion feeds a passport competency', () => {
    for (const r of Object.values(RUBRICS)) {
      assert.equal(Math.round(r.criteria.reduce((s, c) => s + c.weight, 0) * 1000) / 1000, 1, r.mode);
      for (const c of r.criteria) assert.ok(c.competency);
    }
  });
});

describe('scoreRubric (interview scoring)', () => {
  it('maps 1–5 to 0–100 and weights the criteria', () => {
    const tech = scoreRubric(RUBRICS.technical, [
      { key: 'problem_solving', score: 5, evidence: 'compared two approaches' },
      { key: 'technical_depth', score: 4, evidence: 'explained the index' },
      { key: 'system_design', score: 3, evidence: 'mentioned caching' },
      { key: 'communication', score: 2, evidence: 'rambled' },
    ]);
    // 100×.3 + 75×.3 + 50×.2 + 25×.2
    assert.equal(tech.overall, 67.5);
    assert.equal(tech.recommendation, 'ready');
    assert.deepEqual(tech.criteria.map((c) => c.normalized), [100, 75, 50, 25]);
    assert.equal(tech.criteria[0].competency, 'problem_solving');
    assert.equal(scoreRubric(RUBRICS.technical, all('technical', 5)).overall, 100);
    assert.equal(scoreRubric(RUBRICS.technical, all('technical', 1)).recommendation, 'not_ready');
  });

  it('trades: weak safety means not ready, however good the rest is', () => {
    const scores = all('trades_voice', 5).map((s) => (s.key === 'safety_compliance' ? { ...s, score: 2 } : s));
    const r = scoreRubric(RUBRICS.trades_voice, scores);
    assert.ok(r.overall >= 60, 'the total alone would pass');
    assert.equal(r.recommendation, 'not_ready');
    assert.deepEqual(r.gatesFailed, ['safety_compliance']);
    assert.deepEqual(scoreRubric(RUBRICS.trades_voice, all('trades_voice', 3)).gatesFailed, []);
  });

  it('rejects incomplete, duplicated or out-of-range model scores instead of guessing', () => {
    const tech = all('technical', 4);
    assert.throws(() => scoreRubric(RUBRICS.technical, tech.slice(1)), InvalidModelScoresError);
    assert.throws(() => scoreRubric(RUBRICS.technical, [...tech, tech[0]]), InvalidModelScoresError);
    assert.throws(() => scoreRubric(RUBRICS.technical, [{ ...tech[0], score: 6 }, ...tech.slice(1)]), InvalidModelScoresError);
    assert.throws(() => scoreRubric(RUBRICS.technical, [{ ...tech[0], score: 3.5 }, ...tech.slice(1)]), InvalidModelScoresError);
    // A criterion the rubric doesn't have is ignored.
    assert.equal(scoreRubric(RUBRICS.technical, [...tech, { key: 'charisma', score: 5, evidence: '' }]).overall, 75);
  });

  it('recommendation thresholds', () => {
    assert.deepEqual([80, 75, 60, 59.9, 40, 10].map(recommendationFor), ['strong', 'strong', 'ready', 'developing', 'developing', 'not_ready']);
  });
});

// ── StudioService ────────────────────────────────────────────────────────────

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const TRADES = { mode: 'trades_voice' as const, domain: 'Trades (Frontline)', skill: '', language: 'hi' };

/** A scripted interviewer that records what it was asked. */
function fakeModel(assessment?: Partial<ModelAssessment>) {
  const contexts: InterviewContext[] = [];
  const model: InterviewModel = {
    nextQuestion: async (ctx) => {
      contexts.push(ctx);
      return `Q${ctx.questionNumber} (${ctx.language})`;
    },
    assess: async (ctx) => {
      contexts.push(ctx);
      return { criteria: all(ctx.mode, 4), summary: 'Solid.', strengths: ['clear'], improvements: ['depth'], ...assessment };
    },
  };
  return { model, contexts };
}

const transcriptWith = (answers: number, pendingQuestion = true): TranscriptTurn[] => {
  const t: TranscriptTurn[] = [];
  for (let i = 1; i <= answers; i++) {
    t.push({ role: 'interviewer', text: `Q${i}`, at: '' }, { role: 'candidate', text: `A${i}`, at: '' });
  }
  if (pendingQuestion) t.push({ role: 'interviewer', text: `Q${answers + 1}`, at: '' });
  return t;
};

function sessionRow(over: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID, user_id: 'u1', mode: 'technical', domain: 'Software Engineering', skill: 'Backend (Node.js)',
    frontline_role_id: null, language: 'en', status: 'active', transcript: transcriptWith(0), question_count: 1,
    rubric_result: null, credential_code: null, expires_at: new Date(Date.now() + 3_600_000), ...over,
  };
}

function setup(row: Record<string, unknown> | null, model: InterviewModel | null = fakeModel().model, extra: Route[] = []) {
  const db = fakeDb([
    [/^INSERT INTO interview_sessions/, [{ id: SESSION_ID }]],
    [/SELECT \* FROM interview_sessions WHERE id = \$1/, row ? [row] : []],
    [/^UPDATE interview_sessions SET transcript/, [{}]],
    ...extra,
    [/SET status = 'completed'/, [{}]],
  ]);
  const evidence: unknown[] = [];
  const passports = {
    recordEvidence: async (_u: string, items: unknown[]) => {
      evidence.push(...items);
      return { overallScore: 75, competencies: [] };
    },
  } as unknown as TalentPassportService;
  const issued: Record<string, unknown>[] = [];
  const credentials = {
    issue: async (_u: string, kind: string, subject: Record<string, unknown>, opts: Record<string, unknown>) => {
      issued.push({ kind, subject, opts });
      return { code: 'AST-5555-6666-7777', kind, issuedAt: '', expiresAt: null, verifyPath: '/verify/AST-5555-6666-7777' };
    },
  } as unknown as CredentialsService;
  return { svc: new StudioService(db.pool, passports, credentials, model), db, evidence, issued };
}

describe('StudioService.start (POST /interviews/start)', () => {
  it('technical: asks question 1, stores the session with the credit spend id', async () => {
    const { model, contexts } = fakeModel();
    const { svc, db } = setup(null, model);
    const out = await svc.start({ id: 'u1' }, { mode: 'technical', domain: 'Software Engineering', skill: 'Backend (Node.js)' }, 'spend-1');
    assert.deepEqual(out.prompt, { text: 'Q1 (en)', language: 'en', speak: false });
    assert.equal(out.maxQuestions, 8);
    assert.equal(out.canComplete, false);
    assert.equal(contexts[0].transcript.length, 0);
    assert.equal(db.all(/^INSERT INTO interview_sessions/)[0].params[7], 'spend-1');
  });

  it('trades_voice: needs a real frontline role, speaks the chosen language, and is spoken aloud', async () => {
    const { svc } = setup(null);
    await assert.rejects(svc.start({ id: 'u1' }, { ...TRADES, skill: 'Astronaut' }, null), BadRequestException);
    const out = await svc.start({ id: 'u1' }, { ...TRADES, skill: 'Electrician' }, null);
    assert.deepEqual(out.prompt, { text: 'Q1 (hi)', language: 'hi', speak: true });
    assert.equal(out.maxQuestions, 6);
  });

  it('railway roles: stores the frontline role id and passes the railway field to the interviewer', async () => {
    const { model, contexts } = fakeModel();
    const { svc, db } = setup(null, model);
    await svc.start({ id: 'u1' }, { mode: 'trades_voice', domain: 'Railways — Track & Station (Frontline)', skill: 'Pointsman', language: 'bn' }, null);
    assert.equal(db.all(/^INSERT INTO interview_sessions/)[0].params[4], 'pointsman');
    assert.equal(contexts[0].languageLabel, 'Bengali');
    assert.match(contexts[0].domain, /Railways/);
  });

  it('refuses unknown fields and languages, and 503s with no interviewer configured', async () => {
    const { svc } = setup(null);
    await assert.rejects(svc.start({ id: 'u1' }, { mode: 'technical', domain: 'Astrology', skill: 'Charts' }, null), BadRequestException);
    await assert.rejects(svc.start({ id: 'u1' }, { mode: 'technical', domain: 'Software Engineering', skill: 'Go', language: 'xx' }, null), BadRequestException);
    await assert.rejects(setup(null, null).svc.start({ id: 'u1' }, { mode: 'technical', domain: 'Software Engineering', skill: 'Go' }, null),
      (err: unknown) => err instanceof Error && /not configured/.test(err.message));
  });
});

describe('StudioService.turn (POST /interviews/:id/turn)', () => {
  it('records the answer with its voice metadata and asks the next question', async () => {
    const { svc, db } = setup(sessionRow({ mode: 'trades_voice', language: 'ta' }));
    const out = await svc.turn({ id: 'u1' }, SESSION_ID, {
      answer: ' முதலில் பவர் ஆஃப் செய்வேன் ', inputMode: 'voice', detectedLanguage: 'ta', speech: { durationMs: 4200.7, confidence: 1.4 },
    });
    assert.equal(out.prompt?.text, 'Q2 (ta)');
    assert.equal(out.answersGiven, 1);
    const saved = JSON.parse(String(db.all(/^UPDATE interview_sessions SET transcript/)[0].params[2])) as TranscriptTurn[];
    assert.equal(saved[1].text, 'முதலில் பவர் ஆஃப் செய்வேன்');
    assert.deepEqual(saved[1].meta, { inputMode: 'voice', detectedLanguage: 'ta', speech: { durationMs: 4201, confidence: 1 } });
  });

  it('trades interviews are voice-only', async () => {
    const { svc } = setup(sessionRow({ mode: 'trades_voice' }));
    await assert.rejects(svc.turn({ id: 'u1' }, SESSION_ID, { answer: 'typed', inputMode: 'text' }), BadRequestException);
  });

  it('after the last answer there is no next question and the session can be completed', async () => {
    const { model, contexts } = fakeModel();
    const { svc } = setup(sessionRow({ transcript: transcriptWith(7), question_count: 8 }), model);
    const out = await svc.turn({ id: 'u1' }, SESSION_ID, { answer: 'final answer', inputMode: 'text' });
    assert.equal(out.prompt, null);
    assert.equal(out.canComplete, true);
    assert.equal(contexts.length, 0, 'no question 9');
  });

  it('only the owner, only while active, only once per question', async () => {
    await assert.rejects(setup(sessionRow({ user_id: 'u2' })).svc.turn({ id: 'u1' }, SESSION_ID, { answer: 'x', inputMode: 'text' }), ForbiddenException);
    await assert.rejects(setup(sessionRow({ status: 'completed' })).svc.turn({ id: 'u1' }, SESSION_ID, { answer: 'x', inputMode: 'text' }), GoneException);
    await assert.rejects(setup(sessionRow({ expires_at: new Date(Date.now() - 1000) })).svc.turn({ id: 'u1' }, SESSION_ID, { answer: 'x', inputMode: 'text' }), GoneException);
    const raced = fakeDb([
      [/SELECT \* FROM interview_sessions/, [sessionRow()]],
      [/^UPDATE interview_sessions SET transcript/, []], // another window got there first
    ]);
    const svc = new StudioService(raced.pool, {} as TalentPassportService, {} as CredentialsService, fakeModel().model);
    await assert.rejects(svc.turn({ id: 'u1' }, SESSION_ID, { answer: 'x', inputMode: 'text' }), ConflictException);
  });
});

describe('StudioService.complete (POST /interviews/:id/complete)', () => {
  it('returns structured rubric scores, feeds each criterion to the passport and signs a credential', async () => {
    const { svc, evidence, issued, db } = setup(sessionRow({ mode: 'trades_voice', domain: TRADES.domain, skill: 'Welder', language: 'hi', transcript: transcriptWith(3, false) }));
    const out = await svc.complete({ id: 'u1' }, SESSION_ID);
    assert.equal(out.status, 'completed');
    assert.equal(out.rubric.overall, 75);
    assert.equal(out.rubric.recommendation, 'strong');
    assert.deepEqual(out.rubric.criteria.map((c) => c.key), RUBRICS.trades_voice.criteria.map((c) => c.key));
    assert.equal(out.rubric.summary, 'Solid.');
    assert.deepEqual(evidence.map((e) => (e as { competencyKey: string }).competencyKey),
      ['safety_compliance', 'procedural_knowledge', 'situational_judgement', 'equipment_knowledge', 'communication']);
    assert.ok(evidence.every((e) => (e as { source: string; refId: string }).source === 'interview' && (e as { refId: string }).refId === SESSION_ID));
    assert.equal(issued[0].kind, 'interview');
    assert.equal((issued[0].subject as { recommendation: string }).recommendation, 'strong');
    assert.equal(out.credential?.code, 'AST-5555-6666-7777');
    assert.deepEqual(db.tx(), ['BEGIN', 'COMMIT']);
  });

  it('needs at least three answers', async () => {
    await assert.rejects(setup(sessionRow({ transcript: transcriptWith(2) })).svc.complete({ id: 'u1' }, SESSION_ID), ConflictException);
  });

  it('unusable model scores are a 502 and leave the session active to retry', async () => {
    const { model } = fakeModel({ criteria: all('technical', 4).slice(1) });
    const { svc, db, evidence } = setup(sessionRow({ transcript: transcriptWith(3) }), model);
    await assert.rejects(svc.complete({ id: 'u1' }, SESSION_ID), BadGatewayException);
    assert.equal(db.all(/SET status = 'completed'/).length, 0);
    assert.equal(evidence.length, 0);
  });

  it('is idempotent: a completed session returns its stored result without rescoring', async () => {
    const stored = { ...scoreRubric(RUBRICS.technical, all('technical', 3)), summary: 's', strengths: [], improvements: [] };
    const { model, contexts } = fakeModel();
    const { svc } = setup(sessionRow({ status: 'completed', rubric_result: stored }), model);
    const out = await svc.complete({ id: 'u1' }, SESSION_ID);
    assert.equal(out.rubric.overall, 50);
    assert.equal(contexts.length, 0);
  });
});
