'use client';

import { useRef } from 'react';
import { applyEnter, applyTab, type EditResult } from './editor';
import styles from './Career.module.css';

/**
 * A plain-textarea code editor: line numbers, Tab / Shift+Tab indentation and
 * auto-indent on Enter. Escape then Tab leaves the editor (keyboard users must not be
 * trapped in a field that captures Tab).
 */
export function CodeEditor({ value, onChange, onKey, onPaste, label, language }: {
  value: string;
  onChange: (v: string) => void;
  onKey?: () => void;
  onPaste?: (chars: number) => void;
  label: string;
  language: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLPreElement>(null);
  const escaped = useRef(false);
  const lines = value.split('\n').length;

  const apply = (r: EditResult) => {
    onChange(r.value);
    requestAnimationFrame(() => ref.current?.setSelectionRange(r.selectionStart, r.selectionEnd));
  };

  return (
    <div className={styles.editorWrap}>
      <pre ref={gutter} className={styles.gutter} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
      </pre>
      <textarea
        ref={ref}
        className={styles.editor}
        value={value}
        aria-label={label}
        data-language={language}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        wrap="off"
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
        onPaste={(e) => onPaste?.(e.clipboardData.getData('text').length)}
        onKeyDown={(e) => {
          onKey?.();
          const t = e.currentTarget;
          if (e.key === 'Escape') { escaped.current = true; return; }
          if (e.key === 'Tab' && !escaped.current) {
            e.preventDefault();
            apply(applyTab(t.value, t.selectionStart, t.selectionEnd, e.shiftKey));
          } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            apply(applyEnter(t.value, t.selectionStart, t.selectionEnd));
          }
          if (e.key !== 'Escape') escaped.current = false;
        }}
      />
    </div>
  );
}
