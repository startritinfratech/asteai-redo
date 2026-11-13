import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { BotCheckService, TURNSTILE_VERIFY_URL } from './bot-check.service';
import { emailDomain, isDisposableEmail } from './disposable-email';

const config = (secret?: string) => ({ get: () => secret }) as unknown as ConfigService;

function fakeFetch(reply: { ok?: boolean; body?: unknown; throws?: boolean }) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const fn = async (url: string, init: { body: URLSearchParams }) => {
    calls.push({ url, body: init.body });
    if (reply.throws) throw new Error('network down');
    return { ok: reply.ok ?? true, json: async () => reply.body };
  };
  return { fn, calls };
}

describe('disposable email', () => {
  it('finds the domain', () => {
    assert.equal(emailDomain('A@Example.COM'), 'example.com');
    assert.equal(emailDomain('nope'), null);
    assert.equal(emailDomain('x@'), null);
  });
  it('flags listed domains and their subdomains, not lookalikes', () => {
    assert.ok(isDisposableEmail('bot@mailinator.com'));
    assert.ok(isDisposableEmail('bot@eu.mailinator.com'));
    assert.ok(!isDisposableEmail('jane@notmailinator.com'));
    assert.ok(!isDisposableEmail('jane@gmail.com'));
  });
});

describe('BotCheckService', () => {
  it('drops honeypot submissions without calling Turnstile', async () => {
    const f = fakeFetch({ body: { success: true } });
    const svc = new BotCheckService(config('secret-key-123'), f.fn);
    assert.equal(await svc.check({ website: 'http://spam', turnstileToken: 't' }, '1.2.3.4'), 'drop');
    assert.equal(f.calls.length, 0);
  });

  it('skips Turnstile when no secret is configured', async () => {
    const f = fakeFetch({ body: { success: false } });
    const svc = new BotCheckService(config(undefined), f.fn);
    assert.equal(await svc.check({ email: 'a@b.com' }, null), 'ok');
    assert.equal(f.calls.length, 0);
  });

  it('requires a token when a secret is configured', async () => {
    const svc = new BotCheckService(config('secret-key-123'), fakeFetch({ body: { success: true } }).fn);
    await assert.rejects(svc.check({}, null), BadRequestException);
  });

  it('sends secret, token and IP to siteverify and accepts success', async () => {
    const f = fakeFetch({ body: { success: true } });
    const svc = new BotCheckService(config('secret-key-123'), f.fn);
    assert.equal(await svc.check({ turnstileToken: 'tok' }, '9.9.9.9'), 'ok');
    assert.equal(f.calls[0].url, TURNSTILE_VERIFY_URL);
    assert.equal(f.calls[0].body.get('secret'), 'secret-key-123');
    assert.equal(f.calls[0].body.get('response'), 'tok');
    assert.equal(f.calls[0].body.get('remoteip'), '9.9.9.9');
  });

  it('fails closed on a rejected token, an HTTP error or a network error', async () => {
    for (const reply of [{ body: { success: false } }, { ok: false }, { throws: true }]) {
      const svc = new BotCheckService(config('secret-key-123'), fakeFetch(reply).fn);
      await assert.rejects(svc.check({ turnstileToken: 'tok' }, null), BadRequestException);
    }
  });

  it('refuses throwaway inboxes after the human check', async () => {
    const svc = new BotCheckService(config(undefined));
    await assert.rejects(svc.check({ email: 'x@yopmail.com' }, null), /permanent email/);
  });
});
