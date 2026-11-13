import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absolute, breadcrumbLd, faqLd, organizationLd, SITE_URL } from './structuredData';

test('breadcrumbs start at Home and number from 1 with absolute URLs', () => {
  const ld = breadcrumbLd([{ name: 'Blog', path: '/blog' }, { name: 'Post', path: '/blog/x' }]) as {
    itemListElement: { position: number; name: string; item: string }[];
  };
  assert.deepEqual(ld.itemListElement.map((i) => [i.position, i.name]), [[1, 'Home'], [2, 'Blog'], [3, 'Post']]);
  assert.equal(ld.itemListElement[2].item, `${SITE_URL}/blog/x`);
  assert.equal(ld.itemListElement[0].item, SITE_URL);
});

test('FAQ maps questions and answers', () => {
  const ld = faqLd([{ q: 'Q?', a: 'A.' }]) as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
  assert.deepEqual([ld.mainEntity[0].name, ld.mainEntity[0].acceptedAnswer.text], ['Q?', 'A.']);
});

test('organization lists every social profile and the three tracks', () => {
  const ld = organizationLd() as { sameAs: string[]; hasOfferCatalog: { itemListElement: unknown[] } };
  assert.equal(ld.sameAs.length, 5);
  assert.equal(ld.hasOfferCatalog.itemListElement.length, 3);
});

test('absolute keeps full URLs and prefixes paths', () => {
  assert.equal(absolute('https://x.example/a'), 'https://x.example/a');
  assert.equal(absolute('/jobs'), `${SITE_URL}/jobs`);
});
