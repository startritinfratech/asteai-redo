import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isProtectedPath, sessionRedirect } from './sessionGate';
import { oauthStartUrl } from '../app/auth/_components/oauth';

describe('sessionRedirect (middleware)', () => {
  test('sends signed-out visitors of /platform to sign-in, keeping where they were going', () => {
    assert.equal(sessionRedirect('/platform/wallet', '?upgrade=pro', false), '/auth/login?next=%2Fplatform%2Fwallet%3Fupgrade%3Dpro');
    assert.equal(sessionRedirect('/platform', '', false), '/auth/login?next=%2Fplatform');
  });

  test('lets through a session hint, and never touches public pages', () => {
    assert.equal(sessionRedirect('/platform/wallet', '', true), null);
    for (const path of ['/', '/pricing', '/auth/login', '/platformer', '/jobs']) {
      assert.equal(sessionRedirect(path, '', false), null, path);
    }
    assert.equal(isProtectedPath('/platform-tour'), false);
  });
});

describe('oauthStartUrl', () => {
  test('points at the API start endpoint with next and role', () => {
    assert.equal(oauthStartUrl('google'), '/api/v1/auth/oauth/google');
    assert.equal(
      oauthStartUrl('github', { next: '/platform/wallet', role: 'Freelancer' }),
      '/api/v1/auth/oauth/github?next=%2Fplatform%2Fwallet&role=Freelancer',
    );
  });
});
