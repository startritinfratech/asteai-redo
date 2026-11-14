import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import type { ApplicationSummary, CompetencyView, ResumeDraft, VerificationResult } from '@asteai/types';
import { applyEnter, applyTab, TelemetryRecorder } from './editor';
import {
  applicationTimeline, checkResumeFile, credentialBelongs, draftToProfilePatch, groupCompetencies, passportStatus,
  pendingAssessments, percentileLabel, speechLocale, stageProgress,
} from './format';
import { micErrorMessage } from './speech';
import { verifyProofLocally } from './verifyProof';

const app = (o: Partial<ApplicationSummary>): ApplicationSummary => ({
  id: 'a1', candidateId: 'c', requisitionId: 'r', tenantId: 't', stage: 'Applied', t: 1, resultId: null, notes: [],
  scorecards: [], interview: null, offer: null, history: [], requisitionTitle: 'Backend Engineer', ...o,
});

describe('Command Center data', () => {
  test('pending assessments: no result yet and not rejected', () => {
    const apps = [app({ id: 'a' }), app({ id: 'b', resultId: 'R1' }), app({ id: 'c', stage: 'Rejected' })];
    assert.deepEqual(pendingAssessments(apps).map((a) => a.id), ['a']);
  });

  test('timeline merges every stage change, newest first', () => {
    const apps = [
      app({ id: 'a', requisitionTitle: 'SRE', history: [{ t: 10, stage: 'Applied', by: '' }, { t: 30, stage: 'Interview', by: '' }] }),
      app({ id: 'b', requisitionTitle: 'QA', t: 20, stage: 'Applied', history: [] }),
    ];
    assert.deepEqual(applicationTimeline(apps).map((e) => `${e.title}:${e.stage}`), ['SRE:Interview', 'QA:Applied', 'SRE:Applied']);
  });

  test('funnel progress; a rejection keeps the stage it reached', () => {
    assert.equal(stageProgress(app({ stage: 'Applied' })), 0);
    assert.equal(stageProgress(app({ stage: 'Joined' })), 1);
    assert.equal(stageProgress(app({ stage: 'Rejected', history: [{ t: 1, stage: 'Shortlisted', by: '' }, { t: 2, stage: 'Rejected', by: '' }] })), 6 / 8);
  });

  test('passport status and percentile wording', () => {
    assert.equal(passportStatus(undefined), 'empty');
    assert.equal(passportStatus({ competencies: [], visibility: 'public' } as never), 'empty');
    assert.equal(passportStatus({ competencies: [{}], visibility: 'public' } as never), 'public');
    assert.equal(percentileLabel(null), 'Not ranked yet');
    assert.equal(percentileLabel(92.4), 'Top 8%');
    assert.equal(percentileLabel(100), 'Top 1%');
    assert.equal(percentileLabel(30), '30th percentile');
  });

  test('competencies group by category, strongest first', () => {
    const c = (key: string, category: CompetencyView['category'], score: number) => ({ key, category, score } as CompetencyView);
    const groups = groupCompetencies([c('a', 'tech', 50), c('b', 'trades', 90), c('d', 'tech', 80)]);
    assert.deepEqual(groups.map(([g, l]) => [g, l.map((x) => x.key)]), [['Technical', ['d', 'a']], ['Trades & safety', ['b']]]);
  });
});

describe('credential binding on the public passport', () => {
  const valid = (code: string, kind: 'interview' | 'passport_snapshot', subject: Record<string, unknown>) => ({
    valid: true, code, kind, claims: { subject }, proof: {} as never, verifiedAt: '',
  }) as VerificationResult;

  test('accepts the passport’s own codes and snapshots that name it; rejects anyone else’s', () => {
    assert.equal(credentialBelongs(valid('AST-1', 'interview', {}), 'priya', ['AST-1']), true);
    assert.equal(credentialBelongs(valid('AST-2', 'passport_snapshot', { passportSlug: 'priya' }), 'priya', []), true);
    assert.equal(credentialBelongs(valid('AST-3', 'passport_snapshot', { passportSlug: 'mallory' }), 'priya', []), false);
    assert.equal(credentialBelongs(valid('AST-4', 'interview', {}), 'priya', ['AST-1']), false);
    assert.equal(credentialBelongs({ valid: false, code: 'AST-1', reason: 'revoked' }, 'priya', ['AST-1']), false);
  });
});

describe('verifyProofLocally (WebCrypto Ed25519)', () => {
  test('confirms a genuine signature and rejects a tampered payload', async () => {
    const subtle = webcrypto.subtle as unknown as SubtleCrypto;
    const keys = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const jwk = await subtle.exportKey('jwk', keys.publicKey);
    const payload = '{"code":"AST-7K3M-9Q2X-HJ4P","score":82}';
    const sig = Buffer.from(await subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(payload))).toString('base64url');
    const proof = {
      alg: 'EdDSA' as const, keyId: 'k', payload, signature: sig,
      publicKey: { kty: 'OKP' as const, crv: 'Ed25519' as const, x: jwk.x!, kid: 'k', alg: 'EdDSA' as const, use: 'sig' as const },
    };
    assert.equal(await verifyProofLocally(proof, subtle), true);
    assert.equal(await verifyProofLocally({ ...proof, payload: payload.replace('82', '99') }, subtle), false);
    assert.equal(await verifyProofLocally({ ...proof, publicKey: null }, subtle), null);
    assert.equal(await verifyProofLocally(proof, null), null, "no WebCrypto: defer to the server");
  });
});

describe('résumé file checks', () => {
  test('PDF and DOCX up to 5 MB; type and extension must agree', () => {
    assert.deepEqual(checkResumeFile({ name: 'CV.pdf', type: 'application/pdf', size: 10 }), { contentType: 'application/pdf' });
    assert.ok('contentType' in checkResumeFile({ name: 'cv.docx', type: '', size: 10 }), 'empty browser type falls back to the extension');
    assert.match((checkResumeFile({ name: 'cv.doc', type: 'application/msword', size: 10 }) as { error: string }).error, /PDF or Word/);
    assert.match((checkResumeFile({ name: 'cv.pdf', type: 'image/png', size: 10 }) as { error: string }).error, /image\/png/);
    assert.match((checkResumeFile({ name: 'cv.pdf', type: 'application/pdf', size: 6 * 1024 * 1024 }) as { error: string }).error, /6\.0 MB/);
    assert.ok('error' in checkResumeFile({ name: 'cv.pdf', type: 'application/pdf', size: 0 }));
  });

  test('autofill draft → profile patch: ticked, non-empty fields only', () => {
    const draft = {
      fullName: 'P', headline: 'Backend engineer', summary: '', location: 'Pune', yearsExperience: 6, skills: ['Go'], domains: [],
      languages: [], links: { linkedinUrl: 'https://linkedin.com/in/p', githubUrl: '', portfolioUrl: '' }, experience: [], education: [],
    } satisfies ResumeDraft;
    assert.deepEqual(
      draftToProfilePatch(draft, new Set(['headline', 'summary', 'skills', 'domains', 'yearsExperience', 'links'])),
      { headline: 'Backend engineer', skills: ['Go'], yearsExperience: 6, linkedinUrl: 'https://linkedin.com/in/p' },
    );
  });
});

describe('voice', () => {
  test('microphone errors become actionable messages', () => {
    assert.match(micErrorMessage({ name: 'NotAllowedError' }), /blocked/);
    assert.match(micErrorMessage({ error: 'not-allowed' }), /blocked/);
    assert.match(micErrorMessage({ name: 'NotFoundError' }), /No microphone/);
    assert.match(micErrorMessage({ name: 'NotReadableError' }), /in use/);
    assert.match(micErrorMessage({ error: 'no-speech' }), /didn't hear/);
    assert.match(micErrorMessage(null), /could not be started/);
  });

  test('speech locales for Indian languages', () => {
    assert.deepEqual(['hi', 'ta', 'bn', 'en', 'xx'].map(speechLocale), ['hi-IN', 'ta-IN', 'bn-IN', 'en-IN', 'xx']);
  });
});

describe('code editor', () => {
  test('Tab inserts four spaces; with a multi-line selection it indents every line', () => {
    assert.deepEqual(applyTab('ab', 1, 1, false), { value: 'a    b', selectionStart: 5, selectionEnd: 5 });
    const r = applyTab('x\ny\nz', 0, 3, false);
    assert.equal(r.value, '    x\n    y\nz');
  });

  test('Shift+Tab outdents', () => {
    assert.equal(applyTab('    x\n  y', 0, 9, true).value, 'x\ny');
  });

  test('Enter keeps indentation and adds a level after a colon or brace', () => {
    assert.equal(applyEnter('    if x:', 9, 9).value, '    if x:\n        ');
    assert.equal(applyEnter('  foo()', 7, 7).value, '  foo()\n  ');
    assert.equal(applyEnter('fn() {', 6, 6).value, 'fn() {\n    ');
  });

  test('telemetry counts keys, pastes, tab switches and submissions', () => {
    let t = 1_000;
    const rec = new TelemetryRecorder(() => t);
    t = 4_000; rec.key(); rec.key();
    rec.paste(120); rec.hidden(); rec.submitted();
    t = 9_000;
    assert.deepEqual(rec.snapshot(), {
      durationMs: 8_000, timeToFirstKeystrokeMs: 3_000, keystrokes: 2, pasteCount: 1, pastedChars: 120, tabSwitches: 1, runCount: 1,
    });
  });
});
