import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filtersToQuery, parseFilters, primaryRate } from './format';

describe('directory filters', () => {
  it('drops junk and unknown values from the URL', () => {
    assert.deepEqual(
      parseFilters({ q: ' rust ', availability: 'whenever', engagement: 'sprint', minRate: '-4', page: 'abc', sort: ['rate', 'x'] }),
      { q: 'rust', domain: undefined, skill: undefined, minRate: undefined, maxRate: undefined,
        availability: undefined, engagement: 'sprint', sort: 'rate', page: undefined },
    );
  });

  it('round-trips into a query string without empty values or page 1', () => {
    assert.equal(filtersToQuery({ q: 'ml ops', page: 1, skill: undefined }), '?q=ml+ops');
    assert.equal(filtersToQuery({ page: 3 }), '?page=3');
    assert.equal(filtersToQuery({}), '');
  });

  it('picks the headline rate', () => {
    assert.equal(primaryRate({ hourlyRate: null, dailyRate: null, fixedFrom: null, currency: 'INR' }), null);
    assert.match(primaryRate({ hourlyRate: null, dailyRate: 8000, fixedFrom: null, currency: 'INR' }) ?? '', /\/day$/);
  });
});
