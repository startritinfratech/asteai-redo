import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { HOST_REDIRECTS, LEGACY_REDIRECTS } from '../redirects';

const APP_DIR = join(__dirname, 'app');

/**
 * Does a concrete path (":param" segments allowed) resolve to a page under src/app?
 * With `literalOnly`, dynamic folders ([id]) do not count as a match.
 */
function routeExists(path: string, literalOnly = false): boolean {
  const segments = path.split('/').filter(Boolean);
  const walk = (dir: string, i: number): boolean => {
    if (i === segments.length) return existsSync(join(dir, 'page.tsx'));
    const seg = segments[i];
    const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    const literal = !seg.startsWith(':') && entries.find((e) => e.name === seg);
    if (literal && walk(join(dir, literal.name), i + 1)) return true;
    // A dynamic folder ([id], [slug]) accepts any single segment.
    return !literalOnly && entries.some((e) => /^\[[^.\]]+\]$/.test(e.name) && walk(join(dir, e.name), i + 1));
  };
  return walk(APP_DIR, 0);
}

const pathOf = (destination: string) => destination.split(/[?#]/)[0] || '/';

test('every legacy source is listed once', () => {
  const seen = new Set<string>();
  for (const { source } of LEGACY_REDIRECTS) {
    assert.ok(!seen.has(source), `duplicate source ${source}`);
    seen.add(source);
  }
});

test('every redirect is permanent', () => {
  for (const rule of [...LEGACY_REDIRECTS, ...HOST_REDIRECTS]) assert.equal(rule.permanent, true, rule.source);
});

test('every destination is a page that exists in this app', () => {
  for (const { source, destination } of LEGACY_REDIRECTS) {
    assert.ok(routeExists(pathOf(destination)), `${source} → ${destination} has no page`);
  }
});

test('no redirect lands on another redirect (no chains)', () => {
  const sources = new Set(LEGACY_REDIRECTS.map((r) => r.source));
  for (const { source, destination } of LEGACY_REDIRECTS) {
    assert.ok(!sources.has(pathOf(destination)), `${source} → ${destination} is itself redirected`);
  }
});

// Shadowing a dynamic route on purpose is fine (/jobs/new is not a job id); a literal page is not.
test('no redirect hides a page that exists here', () => {
  for (const { source } of LEGACY_REDIRECTS) {
    if (source.includes(':')) continue;
    assert.ok(!routeExists(source, true), `${source} is a live page in this app but is redirected away`);
  }
});

test('legacy /verify/:id never captures the new /verify/certificate route', () => {
  const rule = LEGACY_REDIRECTS.find((r) => r.source.startsWith('/verify/'));
  assert.ok(rule);
  const pattern = new RegExp(`^${rule.source.match(/\((.*)\)$/)![1]}$`);
  assert.ok(pattern.test('abc-123'));
  assert.ok(!pattern.test('certificate'));
});

test('specific /hire/jobs paths come before the :id catch-alls', () => {
  const idx = (s: string) => LEGACY_REDIRECTS.findIndex((r) => r.source === s);
  assert.ok(idx('/hire/jobs/new') < idx('/hire/jobs/:id'));
  assert.ok(idx('/hire/jobs/:id/apply') < idx('/hire/jobs/:id/:rest+'));
});
