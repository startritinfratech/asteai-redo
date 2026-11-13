import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeLink } from './notifications.service';

describe('safeLink', () => {
  it('keeps same-site paths', () => {
    assert.equal(safeLink('/platform/assess?req=REQ-1'), '/platform/assess?req=REQ-1');
    assert.equal(safeLink('/platform/applications'), '/platform/applications');
  });

  it('drops anything that could leave the site', () => {
    for (const bad of ['//evil.example/x', 'https://evil.example', 'javascript:alert(1)', 'platform/assess', '/a b', '/x"onload']) {
      assert.equal(safeLink(bad), '#', bad);
    }
  });
});
