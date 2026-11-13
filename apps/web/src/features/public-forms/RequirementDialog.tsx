'use client';

/**
 * "Submit a requirement": the landing-page lead form, as a three-step dialog
 * (role → requirements → contact). Posts to POST /leads; nothing is faked.
 * `autoOpen` lets one instance open itself from `?requirement=open[&track=…]`.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { clsx } from 'clsx';
import {
  FORM_LIMITS, LEAD_TRACKS, type LeadInput, type LeadTimeline, type LeadTrack, type WorkMode,
} from '@asteai/types';
import { Dialog, Stepper } from '@/components/ui';
import { Turnstile, turnstileRequired, type TurnstileHandle } from '@/components/forms/Turnstile';
import marketing from '@/features/marketing/marketing.module.css';
import page from '@/features/marketing/pages.module.css';
import { formErrorMessage, publicFormsApi } from './api';
import { normalisePhone, validateLeadStep, type Errors, type LeadField } from './validate';
import f from './forms.module.css';

const TRACKS: { id: LeadTrack; name: string; desc: string }[] = [
  { id: 'technical', name: 'Technical', desc: 'AI/ML, engineering, cloud, data' },
  { id: 'professional', name: 'Professional', desc: 'Product, operations, strategy' },
  { id: 'frontline', name: 'Frontline & skilled', desc: 'Field techs, service, trades' },
];
const MODES: { id: WorkMode; name: string }[] = [
  { id: 'remote', name: 'Remote' }, { id: 'hybrid', name: 'Hybrid' }, { id: 'onsite', name: 'On-site' },
];
const TIMELINES: { id: LeadTimeline; name: string }[] = [
  { id: 'immediate', name: 'Immediate (< 48 h)' }, { id: '2weeks', name: 'Within 2 weeks' }, { id: 'flexible', name: 'Flexible' },
];
const STEPS = ['Role', 'Requirements', 'Contact'] as const;
const STEP_FIELDS: LeadField[][] = [['roleTitle'], ['skills'], ['company', 'contactName', 'email', 'phone']];

type Draft = Omit<LeadInput, 'website' | 'turnstileToken' | 'utm'>;
const EMPTY: Draft = {
  track: 'technical', roleTitle: '', skills: '', workMode: 'remote', timeline: 'immediate',
  company: '', contactName: '', email: '', phone: '',
};

function utmFromLocation(): LeadInput['utm'] {
  const p = new URLSearchParams(window.location.search);
  const pick = (k: string) => p.get(`utm_${k}`)?.slice(0, 100) || undefined;
  const utm = { source: pick('source'), medium: pick('medium'), campaign: pick('campaign') };
  return Object.values(utm).some(Boolean) ? utm : undefined;
}

export function RequirementCta({ label = 'Submit a requirement', track, autoOpen = false, className }: {
  label?: string;
  track?: LeadTrack;
  autoOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [initialTrack, setInitialTrack] = useState<LeadTrack>(track ?? 'technical');

  useEffect(() => {
    if (!autoOpen) return;
    const p = new URLSearchParams(window.location.search);
    if (p.get('requirement') !== 'open') return;
    const t = p.get('track') as LeadTrack | null;
    if (t && LEAD_TRACKS.includes(t)) setInitialTrack(t);
    setOpen(true);
  }, [autoOpen]);

  return (
    <>
      <button type="button" className={className ?? `${marketing.btn} ${marketing.btnPrimary}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {label}
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="Submit a hiring requirement" description="We reply within one business day with next steps." size="lg">
        <RequirementForm initialTrack={initialTrack} onClose={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function RequirementForm({ initialTrack, onClose }: { initialTrack: LeadTrack; onClose: () => void }) {
  const id = useId();
  const fid = (k: string) => `${id}-${k}`;
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY, track: initialTrack });
  const [website, setWebsite] = useState('');
  const [token, setToken] = useState('');
  const [errors, setErrors] = useState<Errors<LeadField>>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (errors[k as LeadField]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  useEffect(() => { stepHeading.current?.focus(); }, [step]);

  const checkStep = (s: 0 | 1 | 2) => {
    const found = validateLeadStep(s, draft);
    setErrors(found);
    const first = STEP_FIELDS[s].find((k) => found[k]);
    if (first) document.getElementById(fid(first))?.focus();
    return !first;
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (step < 2) {
      if (checkStep(step)) setStep((step + 1) as 1 | 2);
      return;
    }
    if (!checkStep(2)) return;
    if (turnstileRequired() && !token) { setFormError('Please complete the security check.'); return; }
    setFormError('');
    setPending(true);
    try {
      await publicFormsApi.lead({
        ...draft,
        roleTitle: draft.roleTitle.trim(), skills: draft.skills?.trim() || undefined, company: draft.company.trim(),
        contactName: draft.contactName.trim(), email: draft.email.trim(), phone: normalisePhone(draft.phone),
        utm: utmFromLocation(), website, turnstileToken: token || undefined,
      });
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
        <h3 className={f.successTitle}>Requirement received</h3>
        <p className={marketing.cardText}>
          Thanks, {draft.contactName.split(' ')[0] || 'there'}. Our team will contact you at {draft.email} within one business day
          about your {draft.roleTitle} requirement.
        </p>
        <button type="button" className={`${marketing.btn} ${marketing.btnPrimary}`} onClick={onClose}>Done</button>
      </div>
    );
  }

  const err = (k: LeadField) => errors[k] && <p id={`${fid(k)}-error`} className={f.fieldError}>{errors[k]}</p>;
  const input = (k: LeadField) => ({
    id: fid(k),
    className: clsx(page.control, errors[k] && f.invalid),
    'aria-invalid': errors[k] ? true : undefined,
    'aria-describedby': errors[k] ? `${fid(k)}-error` : undefined,
  });
  const choice = <T extends string>(name: string, legend: string, options: { id: T; name: string; desc?: string }[], value: T, onChange: (v: T) => void) => (
    <fieldset className={f.fieldset}>
      <legend className={f.legend}>{legend}</legend>
      <div className={f.choiceGrid}>
        {options.map((o) => (
          <label key={o.id} className={f.choice}>
            <input type="radio" name={`${id}-${name}`} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} />
            <span className={f.choiceName}>{o.name}</span>
            {o.desc && <span className={f.choiceDesc}>{o.desc}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <form method="post" onSubmit={onSubmit} noValidate style={{ display: 'grid', gap: 16 }}>
      <Stepper steps={STEPS} current={step} />
      <h3 ref={stepHeading} tabIndex={-1} className={f.successTitle} style={{ outline: 'none' }}>
        Step {step + 1} of 3: {STEPS[step]}
      </h3>
      {formError && <div ref={alertRef} className={f.alert} role="alert" tabIndex={-1}>{formError}</div>}
      <div className={f.honeypot} aria-hidden="true">
        <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
      </div>

      {step === 0 && (
        <>
          {choice('track', 'Hiring track', TRACKS, draft.track, (v) => set('track', v))}
          <div className={page.field}>
            <label htmlFor={fid('roleTitle')} className={page.label}>Role title</label>
            <input {...input('roleTitle')} maxLength={FORM_LIMITS.roleTitle.max} placeholder="e.g. Senior ML Engineer or Operations Lead"
              value={draft.roleTitle} onChange={(e) => set('roleTitle', e.target.value)} />
            {err('roleTitle')}
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div className={page.field}>
            <label htmlFor={fid('skills')} className={page.label}>Key skills & requirements <span className={page.optional}>(optional)</span></label>
            <textarea {...input('skills')} rows={4} maxLength={FORM_LIMITS.skills}
              placeholder="e.g. PyTorch, distributed systems, Hindi communication, on-site troubleshooting…"
              value={draft.skills} onChange={(e) => set('skills', e.target.value)} />
            {err('skills')}
          </div>
          {choice('mode', 'Work mode', MODES, draft.workMode, (v) => set('workMode', v))}
          {choice('timeline', 'Timeline', TIMELINES, draft.timeline, (v) => set('timeline', v))}
        </>
      )}

      {step === 2 && (
        <>
          <div className={page.formRow}>
            <div className={page.field}>
              <label htmlFor={fid('company')} className={page.label}>Company</label>
              <input {...input('company')} autoComplete="organization" maxLength={FORM_LIMITS.company.max} value={draft.company} onChange={(e) => set('company', e.target.value)} />
              {err('company')}
            </div>
            <div className={page.field}>
              <label htmlFor={fid('contactName')} className={page.label}>Your name</label>
              <input {...input('contactName')} autoComplete="name" maxLength={FORM_LIMITS.name.max} value={draft.contactName} onChange={(e) => set('contactName', e.target.value)} />
              {err('contactName')}
            </div>
          </div>
          <div className={page.formRow}>
            <div className={page.field}>
              <label htmlFor={fid('email')} className={page.label}>Work email</label>
              <input {...input('email')} type="email" inputMode="email" autoComplete="email" maxLength={FORM_LIMITS.email} value={draft.email} onChange={(e) => set('email', e.target.value)} />
              {err('email')}
            </div>
            <div className={page.field}>
              <label htmlFor={fid('phone')} className={page.label}>Phone</label>
              <input {...input('phone')} type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" maxLength={24} value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
              {err('phone')}
            </div>
          </div>
          <Turnstile ref={turnstile} onToken={setToken} action="lead" />
        </>
      )}

      <div className={f.actions}>
        {step > 0
          ? <button type="button" className={marketing.btn} onClick={() => { setErrors({}); setStep((step - 1) as 0 | 1); }}>← Back</button>
          : <span />}
        <button type="submit" className={`${marketing.btn} ${marketing.btnPrimary}`} disabled={pending} aria-busy={pending}>
          {step < 2 ? 'Continue →' : pending ? 'Sending…' : 'Submit requirement'}
        </button>
      </div>
    </form>
  );
}
