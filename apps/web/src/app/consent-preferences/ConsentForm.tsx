'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/ui';
import {
  ALL_DENIED, ALL_GRANTED, browserGpc, OPTIONAL_CATEGORIES, parseConsentCookie, saveConsent, type OptionalCategory,
} from '@/lib/cookieConsent';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';

const COPY: Record<OptionalCategory | 'necessary', { title: string; text: string }> = {
  necessary: { title: 'Strictly necessary', text: 'Sign-in, security and load balancing. These are always on because the site cannot work without them.' },
  functional: { title: 'Functional', text: 'Remember preferences such as language and theme across visits.' },
  analytics: { title: 'Analytics', text: 'Aggregate usage and error reports (PostHog, New Relic, Sentry) that help us fix and improve the product.' },
  marketing: { title: 'Marketing', text: 'Measure campaigns and show relevant content on other sites. Off whenever your browser sends Global Privacy Control.' },
};

type Choice = Record<OptionalCategory, boolean>;

export function ConsentForm() {
  const toast = useToast();
  const [choice, setChoice] = useState<Choice>({ functional: false, analytics: false, marketing: false });
  const [gpc, setGpc] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    const stored = parseConsentCookie(document.cookie);
    setGpc(browserGpc());
    if (stored) {
      setChoice({ functional: stored.functional, analytics: stored.analytics, marketing: stored.marketing });
      setSavedAt(stored.ts || null);
    }
  }, []);

  const persist = (next: Choice, message: string) => {
    const saved = saveConsent(next);
    setChoice({ functional: saved.functional, analytics: saved.analytics, marketing: saved.marketing });
    setSavedAt(saved.ts);
    toast({ title: message, variant: 'success' });
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); persist(choice, 'Preferences saved'); }}
      aria-describedby="consent-status"
    >
      <ul className={s.consentList}>
        <li className={s.consentItem}>
          <strong>{COPY.necessary.title}</strong>
          <input type="checkbox" className={s.switch} checked disabled aria-label={`${COPY.necessary.title} (always on)`} />
          <p>{COPY.necessary.text}</p>
        </li>
        {OPTIONAL_CATEGORIES.map((c) => {
          const locked = c === 'marketing' && gpc;
          return (
            <li key={c} className={s.consentItem}>
              <label htmlFor={`consent-${c}`}><strong>{COPY[c].title}</strong></label>
              <input
                id={`consent-${c}`}
                type="checkbox"
                className={s.switch}
                checked={locked ? false : choice[c]}
                disabled={locked}
                onChange={(e) => setChoice({ ...choice, [c]: e.target.checked })}
                aria-describedby={`consent-${c}-desc`}
              />
              <p id={`consent-${c}-desc`}>
                {COPY[c].text}
                {locked && ' Your browser is sending Global Privacy Control, so this stays off.'}
              </p>
            </li>
          );
        })}
      </ul>
      <p id="consent-status" className={s.muted} aria-live="polite" style={{ marginBottom: 16 }}>
        {savedAt ? `Last saved ${new Date(savedAt).toLocaleString('en-IN')}.` : 'You haven’t saved a choice yet: only strictly necessary cookies are used.'}
      </p>
      <div className={s.ctaRow}>
        <button type="button" className={`${marketing.btn} ${marketing.btnPrimary}`} onClick={() => persist(ALL_GRANTED, 'All cookies accepted')}>
          Accept all
        </button>
        <button type="button" className={marketing.btn} onClick={() => persist(ALL_DENIED, 'Optional cookies rejected')}>
          Reject all
        </button>
        <button type="submit" className={marketing.btn}>Save my preferences</button>
      </div>
    </form>
  );
}
