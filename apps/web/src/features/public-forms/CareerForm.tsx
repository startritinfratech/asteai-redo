'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { clsx } from 'clsx';
import { FORM_LIMITS, type CareerRole } from '@asteai/types';
import { useHydrated } from '@/hooks/useHydrated';
import { Turnstile, turnstileRequired, type TurnstileHandle } from '@/components/forms/Turnstile';
import marketing from '@/features/marketing/marketing.module.css';
import page from '@/features/marketing/pages.module.css';
import { formErrorMessage, publicFormsApi } from './api';
import { validateCareer, type CareerField, type Errors } from './validate';
import f from './forms.module.css';

const ORDER: CareerField[] = ['roleSlug', 'fullName', 'email', 'profileUrl', 'message'];
const EMPTY: Record<CareerField, string> = { roleSlug: '', fullName: '', email: '', profileUrl: '', message: '' };

/** Careers application. `roles` come from GET /careers/roles (server-rendered). */
export function CareerForm({ roles }: { roles: readonly CareerRole[] }) {
  const id = useId();
  const hydrated = useHydrated();
  const fid = (k: CareerField) => `${id}-${k}`;
  const [values, setValues] = useState(EMPTY);
  const [website, setWebsite] = useState('');
  const [token, setToken] = useState('');
  const [errors, setErrors] = useState<Errors<CareerField>>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const [sentFor, setSentFor] = useState<string | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  const set = (k: CareerField, v: string) => {
    setValues((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFormError('');
    const found = validateCareer(values);
    setErrors(found);
    const first = ORDER.find((k) => found[k]);
    if (first) { document.getElementById(fid(first))?.focus(); return; }
    if (turnstileRequired() && !token) { setFormError('Please complete the security check.'); return; }
    setPending(true);
    try {
      await publicFormsApi.apply({
        roleSlug: values.roleSlug, fullName: values.fullName.trim(), email: values.email.trim(),
        profileUrl: values.profileUrl.trim() || undefined, message: values.message.trim() || undefined,
        website, turnstileToken: token || undefined,
      });
      setSentFor(roles.find((r) => r.slug === values.roleSlug)?.title ?? 'the role');
      setValues(EMPTY);
      requestAnimationFrame(() => successRef.current?.focus());
    } catch (err) {
      setFormError(formErrorMessage(err));
      turnstile.current?.reset();
      requestAnimationFrame(() => alertRef.current?.focus());
    } finally {
      setPending(false);
    }
  }

  if (sentFor) {
    return (
      <div ref={successRef} className={f.success} role="status" tabIndex={-1}>
        <h3 className={f.successTitle}>Application sent</h3>
        <p className={marketing.cardText}>Thanks for applying for {sentFor}. We review every application and reply within two weeks.</p>
        <button type="button" className={marketing.btn} onClick={() => setSentFor(null)}>Apply for another role</button>
      </div>
    );
  }

  const err = (k: CareerField) => errors[k] && <p id={`${fid(k)}-error`} className={f.fieldError}>{errors[k]}</p>;
  const aria = (k: CareerField) => ({
    id: fid(k),
    'aria-invalid': errors[k] ? true : undefined,
    'aria-describedby': errors[k] ? `${fid(k)}-error` : undefined,
    className: clsx(page.control, errors[k] && f.invalid),
  });

  return (
    <form id="apply" method="post" className={page.form} onSubmit={onSubmit} noValidate aria-labelledby={`${id}-h`} style={{ scrollMarginTop: 80 }}>
      <h3 id={`${id}-h`} className={marketing.h2} style={{ fontSize: '1.3rem' }}>Apply now</h3>
      {formError && <div ref={alertRef} className={f.alert} role="alert" tabIndex={-1}>{formError}</div>}
      <div className={f.honeypot} aria-hidden="true">
        <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
      </div>
      <div className={page.field}>
        <label htmlFor={fid('roleSlug')} className={page.label}>Role</label>
        <select {...aria('roleSlug')} value={values.roleSlug} onChange={(e) => set('roleSlug', e.target.value)} required>
          <option value="">Choose a role…</option>
          {roles.map((r) => <option key={r.slug} value={r.slug}>{r.title}</option>)}
        </select>
        {err('roleSlug')}
      </div>
      <div className={page.formRow}>
        <div className={page.field}>
          <label htmlFor={fid('fullName')} className={page.label}>Full name</label>
          <input {...aria('fullName')} autoComplete="name" maxLength={FORM_LIMITS.name.max} value={values.fullName} onChange={(e) => set('fullName', e.target.value)} required />
          {err('fullName')}
        </div>
        <div className={page.field}>
          <label htmlFor={fid('email')} className={page.label}>Email</label>
          <input {...aria('email')} type="email" inputMode="email" autoComplete="email" maxLength={FORM_LIMITS.email} value={values.email} onChange={(e) => set('email', e.target.value)} required />
          {err('email')}
        </div>
      </div>
      <div className={page.field}>
        <label htmlFor={fid('profileUrl')} className={page.label}>LinkedIn / GitHub URL <span className={page.optional}>(optional)</span></label>
        <input {...aria('profileUrl')} type="url" inputMode="url" placeholder="https://" maxLength={FORM_LIMITS.profileUrl} value={values.profileUrl} onChange={(e) => set('profileUrl', e.target.value)} />
        {err('profileUrl')}
      </div>
      <div className={page.field}>
        <label htmlFor={fid('message')} className={page.label}>Why do you want to join ASTEAI? <span className={page.optional}>(optional)</span></label>
        <textarea {...aria('message')} rows={4} maxLength={FORM_LIMITS.careerMessage} value={values.message} onChange={(e) => set('message', e.target.value)} />
        {err('message')}
      </div>
      <Turnstile ref={turnstile} onToken={setToken} action="careers" />
      <button type="submit" className={`${marketing.btn} ${marketing.btnPrimary} ${page.submit}`} disabled={!hydrated || pending} aria-busy={pending}>
        {pending ? 'Sending…' : 'Submit application'}
      </button>
    </form>
  );
}
