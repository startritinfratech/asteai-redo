'use client';

import { useState, type KeyboardEvent } from 'react';
import styles from './profiles.module.css';

/**
 * A list of short tags (skills, domains, languages) edited as removable chips.
 * Enter or comma adds the typed tag; Backspace in an empty box removes the last one.
 * Pass `id` (Field does) so the visible label points at the text box.
 */
export function TagInput({
  id, value, onChange, max, maxLength = 40, placeholder, describedBy,
}: {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
  maxLength?: number;
  placeholder?: string;
  describedBy?: string;
}) {
  const [draft, setDraft] = useState('');
  const full = value.length >= max;

  const add = (raw: string) => {
    const tag = raw.trim().replace(/\s+/g, ' ').slice(0, maxLength);
    setDraft('');
    if (!tag || full || value.some((v) => v.toLowerCase() === tag.toLowerCase())) return;
    onChange([...value, tag]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className={styles.tagBox}>
      {value.map((tag) => (
        <span key={tag} className={styles.chip}>
          <span>{tag}</span>
          <button
            type="button"
            className={styles.chipX}
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(value.filter((v) => v !== tag))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        maxLength={maxLength}
        disabled={full}
        placeholder={full ? `Maximum of ${max} reached` : placeholder}
        aria-describedby={describedBy}
        onChange={(e) => setDraft(e.target.value.replace(',', ''))}
        onKeyDown={onKeyDown}
        onBlur={() => draft && add(draft)}
      />
    </div>
  );
}
