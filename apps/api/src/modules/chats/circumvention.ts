import type { CircumventionPattern } from './chat.types';

/**
 * Spots attempts to take a conversation or payment off the platform. Matching
 * messages are still delivered (the sender gets a warning and a log row is kept for
 * trust & safety), so the patterns lean towards catching rather than precision.
 */

// UPI handles: name@okaxis, 98xxxxxx@ybl… (no dot after the @, so they never look like email).
const UPI_HANDLE =
  /\b[\w.-]{2,}@(?:ok[a-z]+|upi|ybl|ibl|axl|apl|paytm|sbi|icici|hdfcbank|axisbank|kotak|yesbank|pthdfc|ptsbi|ptyes|ptaxis|freecharge|jupiteraxis|slice|fbl|idfcbank|indus|federal|rbl|aubank|barodampay|unionbank|pnb|boi|cnrb|kbl|dbs|citi|hsbc|sc)\b/i;
const UPI_WORDS = /\b(?:upi\s*(?:id|handle|address|pin)?|g\s?pay|google\s?pay|phone\s?pe|paytm|bhim)\b/i;

const EMAIL = /\b[\w.%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/i;
// "name at gmail dot com", "name [at] gmail [dot] com"
const EMAIL_SPELLED = /\b[\w.]+\s*[([]?\s*at\s*[)\]]?\s*[a-z0-9-]+\s*[([]?\s*dot\s*[)\]]?\s*(?:com|in|net|org|co|io)\b/i;

// Candidate digit runs (with spaces, dashes, dots or brackets between digits).
const DIGIT_RUN = /\+?\d[\d\s\-().]{8,}\d/g;

const PAY_OUTSIDE = [
  /\b(?:pay|paying|paid|payment|payments|transfer|send (?:the )?money)\b[^.!?\n]{0,30}\b(?:outside|off[\s-]?(?:the[\s-])?(?:platform|site|app)|directly|direct(?:ly)? to me|bank transfer|cash)\b/i,
  /\b(?:outside|off)\s+(?:of\s+)?(?:the\s+)?(?:platform|site|app|asteai)\b/i,
  /\b(?:avoid|skip|save on|bypass)\b[^.!?\n]{0,20}\b(?:fees?|commission|escrow)\b/i,
];

const WHATSAPP = /\b(?:wh?ats?\s*app|whtsapp|watsapp)\b|\bwa\.me\b/i;
const TELEGRAM = /\btelegram\b|\bt\.me\/|\btg\s*:\s*@/i;

function looksLikePhone(text: string): boolean {
  for (const match of text.match(DIGIT_RUN) ?? []) {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) continue;
    if (match.trim().startsWith('+')) return true;
    // Indian mobiles (optionally prefixed 0 or 91) and formatted NANP numbers like (415) 555-0132.
    if (/^(?:0|91)?[6-9]\d{9}$/.test(digits)) return true;
    if (/^(?:1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]\d{4}$/.test(match.trim())) return true;
  }
  return false;
}

/** Every pattern the message matched, in a stable order (empty when it looks fine). */
export function detectCircumvention(body: string): CircumventionPattern[] {
  const found: CircumventionPattern[] = [];
  const upi = UPI_HANDLE.test(body) || UPI_WORDS.test(body);
  // A UPI handle is not also reported as an email.
  const withoutUpi = body.replace(new RegExp(UPI_HANDLE.source, 'gi'), ' ');
  if (EMAIL.test(withoutUpi) || EMAIL_SPELLED.test(withoutUpi)) found.push('email');
  if (looksLikePhone(body)) found.push('phone');
  if (PAY_OUTSIDE.some((re) => re.test(body))) found.push('pay_outside');
  if (WHATSAPP.test(body)) found.push('whatsapp');
  if (TELEGRAM.test(body)) found.push('telegram');
  if (upi) found.push('upi');
  return found;
}

export const CIRCUMVENTION_WARNING =
  'Keep conversations and payments on AsteAI. Sharing contact details or arranging payment ' +
  'outside the platform is against the terms and removes escrow protection for both of you.';
