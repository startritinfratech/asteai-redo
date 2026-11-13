/**
 * Client-side checks that mirror the API DTOs (FORM_LIMITS), so people see the same rules
 * before submitting. The server stays the authority; these only save a round trip.
 */
import { FORM_LIMITS as L, type ContactInput, type LeadInput } from '@asteai/types';

export type Errors<K extends string> = Partial<Record<K, string>>;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** E.164 after removing spaces, dashes, dots and brackets (same normalisation as the API). */
export const normalisePhone = (v: string) => v.replace(/[\s\-().]/g, '');
export const PHONE_RE = /^\+[1-9]\d{7,14}$/;

/** `what` reads after "Enter" ("a role title"); `noun` starts a sentence ("Role title"). */
function length(v: string, min: number, max: number, what: string, noun: string): string | undefined {
  const t = v.trim();
  if (!t) return `Enter ${what}.`;
  if (t.length < min) return `${noun} must be at least ${min} characters.`;
  if (t.length > max) return `${noun} must be at most ${max} characters.`;
  return undefined;
}

function email(v: string): string | undefined {
  if (!v.trim()) return 'Enter your email address.';
  if (!EMAIL_RE.test(v.trim()) || v.trim().length > L.email) return 'Enter a valid email address, like name@company.com.';
  return undefined;
}

const clean = <K extends string>(e: Errors<K>): Errors<K> =>
  Object.fromEntries(Object.entries(e).filter(([, v]) => v)) as Errors<K>;

export type ContactField = 'name' | 'email' | 'subject' | 'message';
export function validateContact(v: Pick<ContactInput, ContactField>): Errors<ContactField> {
  return clean({
    name: length(v.name, L.name.min, L.name.max, 'your name', 'Name'),
    email: email(v.email),
    subject: length(v.subject, L.subject.min, L.subject.max, 'a subject', 'Subject'),
    message: length(v.message, L.message.min, L.message.max, 'a message', 'Message'),
  });
}

export type LeadField = 'roleTitle' | 'skills' | 'company' | 'contactName' | 'email' | 'phone';
export function validateLeadStep(step: 0 | 1 | 2, v: Partial<LeadInput>): Errors<LeadField> {
  if (step === 0) return clean({ roleTitle: length(v.roleTitle ?? '', L.roleTitle.min, L.roleTitle.max, 'a role title', 'Role title') });
  if (step === 1) return clean({ skills: (v.skills ?? '').length > L.skills ? `Keep requirements under ${L.skills} characters.` : undefined });
  const phone = normalisePhone(v.phone ?? '');
  return clean({
    company: length(v.company ?? '', L.company.min, L.company.max, 'your company name', 'Company name'),
    contactName: length(v.contactName ?? '', L.name.min, L.name.max, 'your name', 'Name'),
    email: email(v.email ?? ''),
    phone: !phone ? 'Enter a phone number.' : PHONE_RE.test(phone) ? undefined : 'Use international format with country code, e.g. +91 98765 43210.',
  });
}

export type CareerField = 'roleSlug' | 'fullName' | 'email' | 'profileUrl' | 'message';
export function validateCareer(v: Record<CareerField, string>): Errors<CareerField> {
  let profileUrl: string | undefined;
  if (v.profileUrl.trim()) {
    try {
      const u = new URL(v.profileUrl.trim());
      if (!/^https?:$/.test(u.protocol)) profileUrl = 'Use an http(s) link.';
    } catch {
      profileUrl = 'Enter a full link, like https://github.com/you.';
    }
  }
  return clean({
    roleSlug: v.roleSlug ? undefined : 'Choose the role you are applying for.',
    fullName: length(v.fullName, L.name.min, L.name.max, 'your full name', 'Full name'),
    email: email(v.email),
    profileUrl,
    message: v.message.length > L.careerMessage ? `Keep it under ${L.careerMessage} characters.` : undefined,
  });
}

export function validateNewsletter(v: string): string | undefined {
  return email(v);
}
