/**
 * WCAG AA contrast for the theme tokens used as text, read straight from globals.css so a
 * token change that breaks readability fails the build. Normal text needs 4.5:1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing ${selector}`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const dark = block(':root');
const light = { ...dark, ...block(":root[data-theme='light']") };

/** Tokens used for running text, links and status text. */
const TEXT = ['fg', 'fg-2', 'fg-3', 'blue-2', 'mint', 'rose', 'gold', 'amber'];
const SURFACES = ['bg', 'bg-2', 'bg-3'];

for (const [name, theme] of [['dark', dark], ['light', light]] as const) {
  test(`${name} theme: text tokens reach 4.5:1 on every surface`, () => {
    const failures: string[] = [];
    for (const t of TEXT) {
      for (const s of SURFACES) {
        const ratio = contrast(theme[t], theme[s]);
        if (ratio < 4.5) failures.push(`--${t} on --${s}: ${ratio.toFixed(2)}`);
      }
    }
    assert.deepEqual(failures, []);
  });

  test(`${name} theme: white button text on --blue reaches 4.5:1`, () => {
    assert.ok(contrast('#ffffff', theme.blue) >= 4.5, `${contrast('#ffffff', theme.blue).toFixed(2)}`);
  });
}
