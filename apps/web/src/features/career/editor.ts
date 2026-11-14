/**
 * Pure helpers for the challenge code editor (editor.spec.ts): indentation keys and the
 * editor telemetry that is sent with a submission (stored for review, never scored).
 */
import type { ChallengeTelemetry } from '@asteai/types';

export const INDENT = '    ';

export interface EditResult { value: string; selectionStart: number; selectionEnd: number }

/** Tab inserts four spaces (or indents every selected line); Shift+Tab outdents. */
export function applyTab(value: string, start: number, end: number, outdent: boolean): EditResult {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const multiLine = value.slice(start, end).includes('\n');

  if (!outdent && !multiLine) {
    return { value: value.slice(0, start) + INDENT + value.slice(end), selectionStart: start + INDENT.length, selectionEnd: start + INDENT.length };
  }
  const blockEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const lines = value.slice(lineStart, blockEnd).split('\n');
  let firstDelta = 0;
  let total = 0;
  const changed = lines.map((line, i) => {
    if (!outdent) {
      if (i === 0) firstDelta = INDENT.length;
      total += INDENT.length;
      return INDENT + line;
    }
    const remove = line.match(/^ {1,4}|^\t/)?.[0].length ?? 0;
    if (i === 0) firstDelta = -remove;
    total -= remove;
    return line.slice(remove);
  });
  const next = value.slice(0, lineStart) + changed.join('\n') + value.slice(blockEnd);
  return {
    value: next,
    selectionStart: Math.max(lineStart, start + firstDelta),
    selectionEnd: Math.max(lineStart, end + total),
  };
}

/** Enter keeps the current line's indentation, plus one level after `:`, `{`, `[` or `(`. */
export function applyEnter(value: string, start: number, end: number): EditResult {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const line = value.slice(lineStart, start);
  const indent = line.match(/^[ \t]*/)?.[0] ?? '';
  const extra = /[:{[(]\s*$/.test(line) ? INDENT : '';
  const insert = `\n${indent}${extra}`;
  const pos = start + insert.length;
  return { value: value.slice(0, start) + insert + value.slice(end), selectionStart: pos, selectionEnd: pos };
}

export class TelemetryRecorder {
  private readonly openedAt: number;
  private firstKeyAt: number | null = null;
  private keystrokes = 0;
  private pasteCount = 0;
  private pastedChars = 0;
  private tabSwitches = 0;
  private runCount = 0;

  constructor(private readonly now: () => number = Date.now) {
    this.openedAt = now();
  }

  key() {
    this.keystrokes++;
    if (this.firstKeyAt === null) this.firstKeyAt = this.now();
  }

  paste(chars: number) {
    this.pasteCount++;
    this.pastedChars += Math.max(0, chars);
  }

  hidden() { this.tabSwitches++; }

  submitted() { this.runCount++; }

  snapshot(): ChallengeTelemetry {
    return {
      durationMs: this.now() - this.openedAt,
      ...(this.firstKeyAt !== null ? { timeToFirstKeystrokeMs: this.firstKeyAt - this.openedAt } : {}),
      keystrokes: this.keystrokes,
      pasteCount: this.pasteCount,
      pastedChars: this.pastedChars,
      tabSwitches: this.tabSwitches,
      runCount: this.runCount,
    };
  }
}
