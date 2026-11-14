import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApplicationSummary, GeneratedJob, Requisition } from '@asteai/types';
import {
  campaignMinutes, canDrop, columnOf, deliveredPct, dropNeighbours, fmtDays, fmtPct, groupByColumn, jobToRequisition,
  listingState, parseRecipients, renderPreview, unknownVariables,
} from './format';

const job: GeneratedJob = {
  title: 'Senior Backend Engineer', summary: 'Own the ledger.',
  band: { level: 'senior', label: 'Senior', yearsMin: 5, yearsMax: 9 },
  responsibilities: ['Design the ledger'], requirements: { mustHave: ['SQL'], niceToHave: [] }, stack: ['Node.js'],
  screeningQuestions: [{ question: 'Authorised to work in India?', type: 'yes_no', options: [], knockout: true, idealAnswer: 'Yes' }],
  evaluationRubric: [{ criterion: 'Design', weight: 100, strongSignals: [], weakSignals: [] }],
  suggestedWeights: { iq: 50, eq: 25, grit: 25 },
};

describe('KPI wording', () => {
  test('days and percentages, with a dash for no data', () => {
    assert.equal(fmtDays(null), '—');
    assert.equal(fmtDays(21), '21 days');
    assert.equal(fmtDays(12.35), '12.3 days');
    assert.equal(fmtPct(null), '—');
    assert.equal(fmtPct(42.5), '42.5%');
  });
});

describe('requisitions', () => {
  const req = (o: Partial<Requisition>) => ({ status: 'Open', posting: { isPublic: true }, approval: { status: 'approved' }, ...o }) as Requisition;

  test('listing state: private, awaiting review, changes requested, live', () => {
    assert.equal(listingState(req({ posting: { isPublic: false } as never })).label, 'Private');
    assert.equal(listingState(req({ approval: { status: 'pending' } as never })).label, 'Awaiting review');
    assert.equal(listingState(req({ approval: { status: 'rejected' } as never })).label, 'Changes requested');
    assert.equal(listingState(req({})).label, 'Live on job board');
    assert.equal(listingState(req({ status: 'Paused' })).label, 'Approved · Paused');
  });

  test('an AI job becomes a valid requisition body (band → ECH level, weights, brief, screening)', () => {
    const body = jobToRequisition(job, { industry: 'Fintech', func: 'Engineering', tier: 'Technical', lang: 'English', location: ' ', headcount: 2 });
    assert.equal(body.echLevel, 4);
    assert.deepEqual(body.weights, { iq: 50, eq: 25, grit: 25 });
    assert.equal(body.location, undefined);
    assert.match(body.brief ?? '', /Responsibilities:\n• Design the ledger[\s\S]*Must have:\n• SQL/);
    assert.equal(body.screeningQuestions?.[0].knockout, true);
    assert.equal(body.evaluationRubric?.[0].weight, 100);
  });
});

describe('pipeline board', () => {
  const app = (id: string, stage: ApplicationSummary['stage']) => ({ id, stage } as ApplicationSummary);

  test('assessment stages sit in the Applied lane; others in their own', () => {
    assert.equal(columnOf('Assessment Review'), 'Applied');
    assert.equal(columnOf('Shortlisted'), 'Shortlisted');
    const lanes = groupByColumn([app('a', 'Applied'), app('b', 'Assessment Pending'), app('c', 'Offer')]);
    assert.deepEqual(lanes.get('Applied')?.map((x) => x.id), ['a', 'b']);
    assert.deepEqual(lanes.get('Offer')?.map((x) => x.id), ['c']);
    assert.deepEqual(lanes.get('Interview'), []);
  });

  test('drop targets follow the API’s transition rules', () => {
    assert.equal(canDrop('Applied', 'Screened', false), true);
    assert.equal(canDrop('Applied', 'Interview', false), false, 'no skipping');
    assert.equal(canDrop('Offer', 'Rejected', false), true);
    assert.equal(canDrop('Joined', 'Offer', false), false);
    assert.equal(canDrop('Joined', 'Offer', true), true, 'admins can correct');
  });
});

describe('pools', () => {
  test('drop neighbours ignore the moving card itself', () => {
    const col = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    assert.deepEqual(dropNeighbours(col, 0, 'x'), { beforeId: undefined, afterId: 'a' });
    assert.deepEqual(dropNeighbours(col, 2, 'x'), { beforeId: 'b', afterId: 'c' });
    assert.deepEqual(dropNeighbours(col, 3, 'x'), { beforeId: 'c', afterId: undefined });
    assert.deepEqual(dropNeighbours(col, 2, 'a'), { beforeId: 'c', afterId: undefined }, 'moving a down within its column');
  });

  test('pasted recipients: names, angle brackets, duplicates and junk', () => {
    const { recipients, invalid } = parseRecipients('Priya Menon <Priya@Example.com>\nrahul@x.io, Rahul S\npriya@example.com\nnot an email\n\n');
    assert.deepEqual(recipients, [
      { email: 'priya@example.com', fullName: 'Priya Menon' },
      { email: 'rahul@x.io', fullName: 'Rahul S' },
    ]);
    assert.deepEqual(invalid, ['not an email']);
  });
});

describe('outreach composer', () => {
  test('preview fills variables; unknown ones are caught before sending', () => {
    assert.equal(renderPreview('Hi {{firstName}} — {{ jobTitle }}', { firstName: 'Priya', jobTitle: 'SRE' }), 'Hi Priya — SRE');
    assert.deepEqual(unknownVariables('{{firstname}} {{firstName}} {{salary}}'), ['firstname', 'salary']);
  });

  test('duration and progress', () => {
    assert.equal(campaignMinutes(1, 60), 0);
    assert.equal(campaignMinutes(121, 60), 2);
    assert.equal(campaignMinutes(10, 1), 9);
    assert.equal(deliveredPct(null), 0);
    assert.equal(deliveredPct({ total: 10, queued: 4, sending: 0, sent: 5, failed: 1, skipped: 0, cancelled: 0 }), 60);
    assert.equal(deliveredPct({ total: 2, queued: 0, sending: 0, sent: 0, failed: 0, skipped: 2, cancelled: 0 }), 100);
  });
});
