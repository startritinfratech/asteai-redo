'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useHydrated } from '@/hooks/useHydrated';
import { Turnstile, turnstileRequired, type TurnstileHandle } from '@/components/forms/Turnstile';
import marketing from '@/features/marketing/marketing.module.css';
import { formErrorMessage, publicFormsApi } from './api';
import { validateNewsletter } from './validate';
import f from './forms.module.css';

/** Footer sign-up. Double opt-in: success means "check your inbox", never "you're subscribed". */
export function NewsletterForm() {
  const id = useId();
  const hydrated = useHydrated();
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [showCheck, setShowCheck] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const err = validateNewsletter(email);
    if (err) { setMsg({ tone: 'error', text: err }); return; }
    if (turnstileRequired() && !token) { setShowCheck(true); setMsg({ tone: 'error', text: 'Please complete the security check.' }); return; }
    setPending(true);
    setMsg(null);
    try {
      await publicFormsApi.subscribe({ email: email.trim(), source: 'footer', website, turnstileToken: token || undefined });
      setMsg({ tone: 'ok', text: 'Almost done: check your inbox to confirm.' });
      setEmail('');
    } catch (e2) {
      setMsg({ tone: 'error', text: formErrorMessage(e2) });
      turnstile.current?.reset();
    } finally {
      setPending(false);
    }
  }

  return (
    <form method="post" className={f.newsletter} onSubmit={onSubmit} noValidate aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className={marketing.footerHeading}>Stay in the loop</h2>
      <div className={f.honeypot} aria-hidden="true">
        <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
      </div>
      <div className={f.newsletterRow}>
        <label htmlFor={`${id}-email`} className={f.honeypot}>Email address</label>
        <input
          id={`${id}-email`}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setShowCheck(true); }}
          aria-invalid={msg?.tone === 'error' || undefined}
          aria-describedby={`${id}-msg`}
        />
        <button type="submit" className={`${marketing.btn} ${marketing.btnPrimary} ${marketing.btnSm}`} disabled={!hydrated || pending} aria-busy={pending}>
          {pending ? '…' : 'Subscribe'}
        </button>
      </div>
      {/* The widget only loads once someone starts typing, so the footer stays light. */}
      {showCheck && <Turnstile ref={turnstile} onToken={setToken} action="newsletter" />}
      <p id={`${id}-msg`} className={f.newsletterMsg} data-tone={msg?.tone} aria-live="polite">
        {msg?.text ?? 'Product news and hiring insights. No spam; unsubscribe any time.'}
      </p>
    </form>
  );
}
