import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from './pagination';

describe('paginate', () => {
  it('defaults missing or junk values', () => {
    assert.deepEqual(paginate(undefined, undefined), { page: 1, pageSize: 20, offset: 0 });
    assert.deepEqual(paginate('abc', '-5'), { page: 1, pageSize: 1, offset: 0 });
  });

  it('clamps the page size to the maximum', () => {
    assert.equal(paginate(1, 1_000_000).pageSize, 100);
  });

  it('computes the offset from page and size', () => {
    assert.equal(paginate('3', '25').offset, 50);
  });
});
