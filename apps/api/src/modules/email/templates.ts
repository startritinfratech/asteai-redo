/**
 * Email templates. Each returns subject, HTML and plain text from typed data. All
 * data is escaped before it reaches the HTML; links are built here from PUBLIC_WEB_URL
 * plus a same-site path, never taken whole from the caller.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface TemplateData {
  'assessment-reset': { firstName: string; requisitionTitle: string; path: string };
  /** `path` is /auth/reset?token=… */
  'password-reset': { firstName: string; path: string; expiresInMinutes: number };
  /** `path` is /auth/verify-email?token=… */
  'verify-email': { firstName: string; path: string };
  'password-changed': { firstName: string; reason: 'changed' | 'reset' };
  'two-factor-enabled': { firstName: string };
  /** An admin's decision on a submitted expert profile; `note` is the admin's note to the expert. */
  'expert-profile-decision': {
    firstName: string;
    decision: 'approved' | 'rejected' | 'rework';
    note: string | null;
    path: '/platform/profile';
  };
}

export type TemplateName = keyof TemplateData;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** An absolute URL for a same-site path; anything else falls back to the site root. */
export function siteUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return /^\/(?!\/)/.test(path) ? `${base}${path}` : `${base}/`;
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#f4f4fa;font-family:Segoe UI,Arial,sans-serif;color:#121124;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dcdcea;border-radius:12px;">
    <tr><td style="padding:20px 24px;border-bottom:1px solid #ececf5;font-weight:700;letter-spacing:.14em;">ASTEAI</td></tr>
    <tr><td style="padding:24px;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
    <tr><td style="padding:16px 24px;border-top:1px solid #ececf5;font-size:12px;color:#6b6e8a;">You are receiving this because you have an AsteAI account. This is a service message about your account.</td></tr>
  </table>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#2f6fe8;color:#ffffff;text-decoration:none;font-weight:600;">${escapeHtml(label)}</a></p>`;
}

/** A simple notice: greeting, paragraphs, optional button and a fallback link. */
function notice(
  subject: string, firstName: string, paragraphs: string[], baseUrl: string, link?: { path: string; label: string },
): RenderedEmail {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const url = link ? siteUrl(baseUrl, link.path) : null;
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    ...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
    ...(url && link ? [
      button(url, link.label),
      `<p style="font-size:13px;color:#6b6e8a;">If the button doesn't work, copy this link into your browser:<br>${escapeHtml(url)}</p>`,
    ] : []),
  ].join('');
  const text = [greeting, '', ...paragraphs.flatMap((p) => [p, '']), ...(url && link ? [`${link.label}: ${url}`] : [])]
    .join('\n').trimEnd();
  return { subject, html: layout(subject, html), text };
}

const EXPERT_DECISION_COPY: Record<TemplateData['expert-profile-decision']['decision'], { subject: string; body: string }> = {
  approved: {
    subject: 'Your expert profile is approved',
    body: 'Good news: your AsteAI expert profile has been approved and is now listed in the expert directory, where buyers can find you.',
  },
  rework: {
    subject: 'Changes requested on your expert profile',
    body: 'An AsteAI reviewer looked at your expert profile and asked for some changes before it can be listed. Update your profile and submit it again.',
  },
  rejected: {
    subject: 'Your expert profile was not approved',
    body: 'An AsteAI reviewer looked at your expert profile and could not approve it for the expert directory.',
  },
};

const SECURITY_FOOTNOTE = 'If this wasn’t you, reset your password straight away and contact AsteAI support.';

type Renderer<T> = (data: T, baseUrl: string) => RenderedEmail;

const TEMPLATES: { [K in TemplateName]: Renderer<TemplateData[K]> } = {
  'assessment-reset': ({ firstName, requisitionTitle, path }, baseUrl) => {
    const url = siteUrl(baseUrl, path);
    const subject = `Your assessment for ${requisitionTitle} has been reset`;
    const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
    return {
      subject,
      html: layout(subject, [
        `<p>${escapeHtml(greeting)}</p>`,
        `<p>Our support team has reset your role-fit assessment for <b>${escapeHtml(requisitionTitle)}</b>. You can start it again whenever you are ready; it begins from the first question.</p>`,
        button(url, 'Start the assessment'),
        `<p style="font-size:13px;color:#6b6e8a;">If the button doesn't work, copy this link into your browser:<br>${escapeHtml(url)}</p>`,
      ].join('')),
      text: [
        greeting,
        '',
        `Our support team has reset your role-fit assessment for ${requisitionTitle}. You can start it again whenever you are ready; it begins from the first question.`,
        '',
        `Start the assessment: ${url}`,
      ].join('\n'),
    };
  },

  'password-reset': ({ firstName, path, expiresInMinutes }, baseUrl) => notice(
    'Reset your AsteAI password',
    firstName,
    [
      'We received a request to reset the password for your AsteAI account. Use the button below to choose a new one.',
      `The link works once and expires in ${expiresInMinutes} minutes. If you didn’t ask for this, you can ignore this email; your password stays the same.`,
    ],
    baseUrl,
    { path, label: 'Reset password' },
  ),

  'verify-email': ({ firstName, path }, baseUrl) => notice(
    'Confirm your email address',
    firstName,
    ['Please confirm that this is your email address for AsteAI. The link expires in 24 hours.'],
    baseUrl,
    { path, label: 'Confirm email' },
  ),

  'password-changed': ({ firstName, reason }, baseUrl) => notice(
    'Your AsteAI password was changed',
    firstName,
    [
      reason === 'reset'
        ? 'The password for your AsteAI account was just reset using a link sent to this address. You have been signed out on every device.'
        : 'The password for your AsteAI account was just changed. Other devices have been signed out.',
      SECURITY_FOOTNOTE,
    ],
    baseUrl,
    { path: '/auth/forgot', label: 'Reset password' },
  ),

  'two-factor-enabled': ({ firstName }, baseUrl) => notice(
    'Two-factor authentication is on',
    firstName,
    [
      'Two-factor authentication is now on for your AsteAI account. Signing in will ask for a code from your authenticator app. Keep your backup codes somewhere safe.',
      SECURITY_FOOTNOTE,
    ],
    baseUrl,
    { path: '/platform/security', label: 'Review security settings' },
  ),

  'expert-profile-decision': ({ firstName, decision, note, path }, baseUrl) => {
    const copy = EXPERT_DECISION_COPY[decision];
    return notice(
      copy.subject,
      firstName,
      [copy.body, ...(note ? [`Note from the reviewer: ${note}`] : [])],
      baseUrl,
      { path, label: 'Open your profile' },
    );
  },
};

export function render<K extends TemplateName>(name: K, data: TemplateData[K], baseUrl: string): RenderedEmail {
  return (TEMPLATES[name] as Renderer<TemplateData[K]>)(data, baseUrl);
}
