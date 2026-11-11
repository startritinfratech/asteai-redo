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
  /** A tenant member added someone to the team; `path` is /auth/reset?token=… (sets the first password). */
  'team-invite': { inviterName: string; tenantName: string; firstName: string; path: string };
  /** Razorpay confirmed the buyer's escrow payment for a milestone; `amount` is formatted. */
  'payment-received': { firstName: string; amount: string; contractId: string; milestoneTitle: string; path: string };
  /** Razorpay processed a refund of cancelled-contract escrow to the buyer; `amount` is formatted. */
  'refund-issued': { firstName: string; amount: string; contractId: string; path: string };
  /** An admin's decision on a submitted expert profile; `note` is the admin's note to the expert. */
  'expert-profile-decision': {
    firstName: string;
    decision: 'approved' | 'rejected' | 'rework';
    note: string | null;
    path: '/platform/profile';
  };
  /** An admin recorded a manual payout transfer; `amount` is formatted, `reference` the bank UTR. */
  'payout-paid': { firstName: string; amount: string; reference: string; path: '/platform/wallet' };
  /** An admin rejected a payout request; `note` is the admin's reason. */
  'payout-rejected': { firstName: string; amount: string; note: string; path: '/platform/wallet' };
  /** A captured escrow payment produced an invoice (sent to the buyer). */
  'invoice-issued': {
    firstName: string;
    invoiceId: string;
    amount: string;
    projectTitle: string;
    milestoneTitle: string;
    path: '/platform/invoices';
  };
  /** The other party of a contract raised a dispute; `respondBy` is a formatted date-time. */
  'dispute-opened': {
    firstName: string;
    raisedByName: string;
    contractId: string;
    milestoneTitle: string | null;
    reason: string;
    respondBy: string;
    path: string;
  };
  /** An admin's decision on a submitted service listing; `note` is the admin's note to the expert. */
  'service-decision': { firstName: string; decision: 'published' | 'rejected'; title: string; note: string | null; path: '/platform/my-services' };
  /** A delivered gig order will be accepted automatically in `daysLeft` days unless the buyer acts. */
  'gig-delivery-reminder': { firstName: string; serviceTitle: string; daysLeft: number; path: string };
  /** A delivered gig order was accepted automatically and the payment released (sent to both parties). */
  'gig-auto-accepted': { firstName: string; serviceTitle: string; audience: 'buyer' | 'expert'; path: string };
  /** An admin resolved a dispute; `outcome` is a sentence describing what happened to the money. */
  'dispute-resolved': { firstName: string; disputeId: string; contractId: string; outcome: string; note: string; path: string };
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

  'team-invite': ({ inviterName, tenantName, firstName, path }, baseUrl) => notice(
    `You've been invited to ${tenantName || 'a team'} on AsteAI`,
    firstName,
    [
      `${inviterName || 'A colleague'} added you to ${tenantName ? `the ${tenantName}` : 'their'} team on AsteAI. Choose a password to activate your account and sign in.`,
      'The link works once and expires in 7 days. If you weren’t expecting this, you can ignore this email.',
    ],
    baseUrl,
    { path, label: 'Set your password' },
  ),

  'payment-received': ({ firstName, amount, contractId, milestoneTitle, path }, baseUrl) => notice(
    `Payment of ${amount} received`,
    firstName,
    [
      `We received your payment of ${amount} for milestone "${milestoneTitle}" on contract ${contractId}. It is held in escrow until you release it to the expert.`,
    ],
    baseUrl,
    { path, label: 'Open the contract' },
  ),

  'refund-issued': ({ firstName, amount, contractId, path }, baseUrl) => notice(
    `Your refund of ${amount} has been processed`,
    firstName,
    [
      `We have refunded ${amount} from escrow on contract ${contractId} to your original payment method.`,
      'Refunds usually reach your account within 5–7 working days, depending on your bank.',
    ],
    baseUrl,
    { path, label: 'Open the contract' },
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

  'gig-delivery-reminder': ({ firstName, serviceTitle, daysLeft, path }, baseUrl) => notice(
    'Your order will be accepted automatically',
    firstName,
    [
      `The delivery for "${serviceTitle}" is waiting for your review. If you do nothing, it will be accepted automatically and the payment released to the expert in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
      'Open the order to accept it, request a revision or open a dispute.',
    ],
    baseUrl,
    { path, label: 'Review the delivery' },
  ),

  'gig-auto-accepted': ({ firstName, serviceTitle, audience, path }, baseUrl) => notice(
    'Order accepted automatically',
    firstName,
    [
      audience === 'buyer'
        ? `The delivery for "${serviceTitle}" was not reviewed in time, so it was accepted automatically and the payment was released to the expert.`
        : `The buyer did not review your delivery for "${serviceTitle}" in time, so it was accepted automatically and your payment was released.`,
    ],
    baseUrl,
    { path, label: 'Open the order' },
  ),

  'service-decision': ({ firstName, decision, title, note, path }, baseUrl) => notice(
    decision === 'published' ? 'Your service is now live' : 'Your service was not approved',
    firstName,
    [
      decision === 'published'
        ? `Your service "${title}" has been approved and is now listed for buyers to order.`
        : `Your service "${title}" could not be approved for the catalogue. You can edit it and submit it again.`,
      ...(note ? [`Note from the reviewer: ${note}`] : []),
    ],
    baseUrl,
    { path, label: 'Open my services' },
  ),

  'payout-paid': ({ firstName, amount, reference, path }, baseUrl) => notice(
    `Your payout of ${amount} has been paid`,
    firstName,
    [
      `We have transferred ${amount} to your payout account. Bank reference (UTR): ${reference}.`,
      'Transfers can take up to one working day to show in your account, depending on your bank.',
    ],
    baseUrl,
    { path, label: 'Open your wallet' },
  ),

  'payout-rejected': ({ firstName, amount, note, path }, baseUrl) => notice(
    'Your payout request was not approved',
    firstName,
    [
      `Your payout request of ${amount} was rejected, and the amount is available in your wallet again.`,
      `Reason: ${note}`,
    ],
    baseUrl,
    { path, label: 'Open your wallet' },
  ),

  'invoice-issued': ({ firstName, invoiceId, amount, projectTitle, milestoneTitle, path }, baseUrl) => notice(
    `Invoice ${invoiceId} for your escrow payment`,
    firstName,
    [
      `We received your payment of ${amount} into escrow for "${milestoneTitle}" on ${projectTitle || 'your project'}.`,
      `Invoice ${invoiceId} is ready to download.`,
    ],
    baseUrl,
    { path, label: 'View invoices' },
  ),

  'dispute-opened': ({ firstName, raisedByName, contractId, milestoneTitle, reason, respondBy, path }, baseUrl) => notice(
    `A dispute was raised on contract ${contractId}`,
    firstName,
    [
      `${raisedByName || 'The other party'} raised a dispute on contract ${contractId}${milestoneTitle ? ` (milestone "${milestoneTitle}")` : ''}. Reason: ${reason}.`,
      'The contract is paused while the dispute is open: no milestone can be moved, funded or released.',
      `Please reply with your side of the story by ${respondBy}. After that the dispute goes to the AsteAI team for review.`,
    ],
    baseUrl,
    { path, label: 'Open the dispute' },
  ),

  'dispute-resolved': ({ firstName, disputeId, contractId, outcome, note, path }, baseUrl) => notice(
    `Dispute ${disputeId} has been resolved`,
    firstName,
    [
      `The AsteAI team resolved dispute ${disputeId} on contract ${contractId}. ${outcome}`,
      `Note from the reviewer: ${note}`,
    ],
    baseUrl,
    { path, label: 'Open the dispute' },
  ),
};

export function render<K extends TemplateName>(name: K, data: TemplateData[K], baseUrl: string): RenderedEmail {
  return (TEMPLATES[name] as Renderer<TemplateData[K]>)(data, baseUrl);
}
