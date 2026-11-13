import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { User } from '@asteai/types';
import { AssistantService } from './assistant.service';
import type { VoiceCommandDto } from './dto/voice-command.dto';

const user = { id: 'u1', role: 'Employer' } as Pick<User, 'id' | 'role'>;

const cmd: VoiceCommandDto = {
  utterance: 'open my requisitions',
  pathname: '/platform/applications',
  language: 'en-IN',
  targets: [
    { id: 'route:requisitions', kind: 'route', label: 'Requisitions' },
    { id: 'action:requisitions.create', kind: 'action', label: 'New Requisition' },
    { id: 'action:proposals.award', kind: 'action', label: 'Award proposal', confirm: true },
    { id: 'field:requisitions.search', kind: 'field', label: 'Search' },
  ],
};

function config(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/** A service whose Claude client returns `reply` (text block content) or a whole message. */
function serviceReplying(reply: unknown, stopReason = 'end_turn') {
  const calls: Record<string, unknown>[] = [];
  const svc = new AssistantService(config({ ANTHROPIC_API_KEY: 'test-key' }));
  const fake = {
    beta: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params);
          const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
          return { stop_reason: stopReason, content: stopReason === 'refusal' ? [] : [{ type: 'text', text }] };
        },
      },
    },
  };
  (svc as unknown as { client: unknown }).client = fake;
  return { svc, calls };
}

describe('AssistantService', () => {
  it('returns 503 when no API key is configured', async () => {
    const svc = new AssistantService(config({}));
    await assert.rejects(svc.resolve(user, cmd), (err: HttpException) => err.getStatus() === 503);
  });

  it('accepts a navigate to an offered route', async () => {
    const { svc, calls } = serviceReplying({ kind: 'navigate', targetId: 'route:requisitions', value: '', speech: 'Opening Requisitions.' });
    const result = await svc.resolve(user, cmd);
    assert.deepEqual(result, {
      kind: 'navigate', targetId: 'route:requisitions', value: null, speech: 'Opening Requisitions.', needsConfirmation: false,
    });

    const params = calls[0];
    assert.equal(params.model, 'claude-opus-5-5');
    assert.equal(params.fallbacks, 'default');
    assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
    const content = (params.messages as { content: string }[])[0].content;
    assert.match(content, /<targets>[\s\S]*route:requisitions[\s\S]*<\/targets>/);
    assert.match(content, /<utterance>open my requisitions<\/utterance>/);
  });

  it('uses ASSISTANT_MODEL when set', async () => {
    const svc = new AssistantService(config({ ANTHROPIC_API_KEY: 'k', ASSISTANT_MODEL: 'claude-sonnet-5-5' }));
    let model = '';
    (svc as unknown as { client: unknown }).client = {
      beta: { messages: { create: async (p: { model: string }) => {
        model = p.model;
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"kind":"back","targetId":"","value":"","speech":"Back."}' }] };
      } } },
    };
    await svc.resolve(user, cmd);
    assert.equal(model, 'claude-sonnet-5-5');
  });

  it('turns an invented target into a clarify', async () => {
    const { svc } = serviceReplying({ kind: 'navigate', targetId: 'route:billing', value: '', speech: 'Opening billing.' });
    const result = await svc.resolve(user, cmd);
    assert.equal(result.kind, 'clarify');
    assert.equal(result.targetId, null);
  });

  it('rejects a target of the wrong kind for the action', async () => {
    const { svc } = serviceReplying({ kind: 'navigate', targetId: 'action:requisitions.create', value: '', speech: '' });
    assert.equal((await svc.resolve(user, cmd)).kind, 'clarify');
  });

  it('marks targets flagged confirm as needing confirmation', async () => {
    const { svc } = serviceReplying({ kind: 'invoke', targetId: 'action:proposals.award', value: '', speech: 'Awarding.' });
    const result = await svc.resolve(user, cmd);
    assert.equal(result.kind, 'invoke');
    assert.equal(result.needsConfirmation, true);
  });

  it('keeps the value only for fill', async () => {
    const fill = serviceReplying({ kind: 'fill', targetId: 'field:requisitions.search', value: 'react', speech: 'Searching.' });
    assert.equal((await fill.svc.resolve(user, cmd)).value, 'react');
    const invoke = serviceReplying({ kind: 'invoke', targetId: 'action:requisitions.create', value: 'junk', speech: '' });
    assert.equal((await invoke.svc.resolve(user, cmd)).value, null);
  });

  it('normalises scroll direction', async () => {
    const { svc } = serviceReplying({ kind: 'scroll', targetId: 'route:requisitions', value: 'sideways', speech: '' });
    const result = await svc.resolve(user, cmd);
    assert.deepEqual([result.kind, result.targetId, result.value], ['scroll', null, 'down']);
  });

  it('answers a refusal with a clarify', async () => {
    const { svc } = serviceReplying('', 'refusal');
    assert.equal((await svc.resolve(user, cmd)).kind, 'clarify');
  });

  it('answers unparseable output with a clarify', async () => {
    const { svc } = serviceReplying('not json');
    assert.equal((await svc.resolve(user, cmd)).kind, 'clarify');
  });
});
