'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { clsx } from 'clsx';
import { FORM_LIMITS } from '@asteai/types';
import { useHydrated } from '@/hooks/useHydrated';
import { Turnstile, turnstileRequired, type TurnstileHandle } from '@/components/forms/Turnstile';
import marketing from '@/features/marketing/marketing.module.css';
import page from '@/features/marketing/pages.module.css';
import { formErrorMessage, publicFormsApi } from './api';
import { validateContact, type ContactField, type Errors } from './validate';
import f from './forms.module.css';

const ORDER: ContactField[] = ['name', 'email', 'subject', 'message'];
const DEMO_MESSAGE = 'Hi, I’d like to book an enterprise demo of ASTEAI Hire.';

/** Contact / demo-request form. `?intent=demo` prefills a demo request and scrolls here. */
export function ContactForm() {
  const isDemo = useSearchParams().get('intent') === 'demo';
  const hydrated = useHydrated();
  const id = useId();
  const fid = (k: ContactField) => `${id}-${k}`;
  const [values, setValues] = useState({ name: '', email: '', subject: isDemo ? 'Enterprise demo' : '', message: isDemo ? DEMO_MESSAGE : '' });
  const [website, setWebsite] = useState('');
  const [token, setToken] = useState('');
  const [errors, setErrors] = useState<Errors<ContactField>>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const rootRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  useEffect(() => {
    if (isDemo) rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [isDemo]);

  const set = (k: ContactField, v: string) => {
    setValues((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFormError('');
    const found = validateContact(values);
    setErrors(found);
    const first = ORDER.find((k) => found[k]);
    if (first) { document.getElementById(fid(first))?.focus(); return; }
    if (turnstileRequired() && !token) { setFormError('Please complete the security check.'); return; }

    setPending(true);
    try {
      await publicFormsApi.contact({ ...values, intent: isDemo ? 'demo' : 'contact', website, turnstileToken: token || undefined });
      setSent(true);
      requestAnimationFrame(() => successRef.current?.focus());
    } catch (err) {
      setFormError(formErrorMessage(err));
      turnstile.current?.reset();
      requestAnimationFrame(() => alertRef.current?.focus());
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div ref={successRef} className={f.success} role="status" tabIndex={-1}>
        <h2 className={f.successTitle}>{isDemo ? 'Demo request sent' : 'Message sent'}</h2>
        <p className={marketing.cardText}>
          {isDemo ? 'We’ll be in touch shortly to schedule your demo.' : 'Thanks for contacting us. We usually reply within one business day.'}{' '}
          A confirmation is on its way to {values.email}.
        </p>
        <button type="button" className={marketing.btn} onClick={() => { setSent(false); setValues({ name: '', email: '', subject: '', message: '' }); }}>
          Send another message
        </button>
      </div>
    );
  }

  const field = (k: ContactField, label: string, input: JSX.Element) => (
    <div className={page.field}>
      <label htmlFor={fid(k)} className={page.label}>{label}</label>
      {input}
      {errors[k] && <p id={`${fid(k)}-error`} className={f.fieldError}>{errors[k]}</p>}
    </div>
  );
  const common = (k: ContactField) => ({
    id: fid(k),
    name: k,
    value: values[k],
    className: clsx(page.control, errors[k] && f.invalid),
    'aria-invalid': errors[k] ? true : undefined,
    'aria-describedby': errors[k] ? `${fid(k)}-error` : undefined,
    required: true,
  });

  return (
    <form ref={rootRef} method="post" className={page.form} onSubmit={onSubmit} noValidate aria-labelledby="form-title" style={{ scrollMarginTop: 80 }}>
      <div>
        <h2 id="form-title" className={marketing.h2}>{isDemo ? 'Book a demo' : 'Send us a message'}</h2>
        <p className={marketing.cardText}>We usually reply within one business day.</p>
      </div>
      {formError && <div ref={alertRef} className={f.alert} role="alert" tabIndex={-1}>{formError}</div>}
      <div className={f.honeypot} aria-hidden="true">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
      </div>
      <div className={page.formRow}>
        {field('name', 'Name', <input {...common('name')} autoComplete="name" maxLength={FORM_LIMITS.name.max} onChange={(e) => set('name', e.target.value)} />)}
        {field('email', 'Email', <input {...common('email')} type="email" inputMode="email" autoComplete="email" maxLength={FORM_LIMITS.email} onChange={(e) => set('email', e.target.value)} />)}
      </div>
      {field('subject', 'Subject', <input {...common('subject')} maxLength={FORM_LIMITS.subject.max} onChange={(e) => set('subject', e.target.value)} />)}
      {field('message', 'Message', (
        <textarea {...common('message')} rows={6} maxLength={FORM_LIMITS.message.max} placeholder="Tell us more about your inquiry…" onChange={(e) => set('message', e.target.value)} />
      ))}
      <Turnstile ref={turnstile} onToken={setToken} action="contact" />
      <button type="submit" className={`${marketing.btn} ${marketing.btnPrimary} ${page.submit}`} disabled={!hydrated || pending} aria-busy={pending}>
        {pending ? 'Sending…' : isDemo ? 'Request demo' : 'Send message'}
      </button>
    </form>
  );
}
