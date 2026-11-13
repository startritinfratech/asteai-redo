import { seal, unseal } from '../auth/totp';
import {
  ACCOUNT_NUMBER_PATTERN, IFSC_PATTERN, UPI_PATTERN,
  type PayoutAccountInput, type PayoutDestination, type PayoutMethod,
} from '../ledger/billing-types';

/**
 * Payout destinations: validation, masking, and sealing of the full details.
 *
 * The full account number / UPI id is stored only sealed (AES-256-GCM, auth/totp.ts seal);
 * the sealed JSON also carries the owner's user id, so a sealed value copied onto another
 * user's row is refused when it is opened.
 */

export interface NormalizedPayoutAccount {
  method: PayoutMethod;
  accountHolder: string;
  accountNumber?: string;
  ifsc?: string;
  upiId?: string;
}

export interface MaskedPayoutAccount {
  last4: string | null;
  ifsc: string | null;
  upiMasked: string | null;
  /** One line for lists: 'XXXXXX1234 · HDFC0001234' or 'ra****@okhdfc'. */
  masked: string;
}

export type ParsedPayoutAccount = { account: NormalizedPayoutAccount; error: null } | { account: null; error: string };

/** Trims and upper-cases what the user typed, then checks it. Spaces in account numbers are ignored. */
export function parsePayoutAccount(input: PayoutAccountInput): ParsedPayoutAccount {
  const fail = (error: string): ParsedPayoutAccount => ({ account: null, error });
  const accountHolder = (input.accountHolder ?? '').trim().replace(/\s+/g, ' ');
  if (accountHolder.length < 2 || accountHolder.length > 100) return fail('Account holder name must be 2 to 100 characters');

  if (input.method === 'bank') {
    if (input.upiId) return fail('A bank account takes an account number and IFSC, not a UPI id');
    const accountNumber = (input.accountNumber ?? '').replace(/[\s-]/g, '');
    const ifsc = (input.ifsc ?? '').trim().toUpperCase();
    if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber)) return fail('Account number must be 9 to 18 digits');
    if (!IFSC_PATTERN.test(ifsc)) return fail('IFSC must look like HDFC0001234 (4 letters, 0, then 6 letters or digits)');
    return { account: { method: 'bank', accountHolder, accountNumber, ifsc }, error: null };
  }
  if (input.method === 'upi') {
    if (input.accountNumber || input.ifsc) return fail('A UPI payout takes a UPI id, not bank details');
    const upiId = (input.upiId ?? '').trim();
    if (upiId.length > 100 || !UPI_PATTERN.test(upiId)) return fail('UPI id must look like name@bank');
    return { account: { method: 'upi', accountHolder, upiId }, error: null };
  }
  return fail("method must be 'bank' or 'upi'");
}

/** 'ra****@okhdfc': the first two characters of the handle and the provider. */
export function maskUpi(upiId: string): string {
  const at = upiId.lastIndexOf('@');
  const handle = upiId.slice(0, at);
  return `${handle.slice(0, 2)}****${upiId.slice(at)}`;
}

export function maskAccount(account: NormalizedPayoutAccount): MaskedPayoutAccount {
  if (account.method === 'bank') {
    const number = account.accountNumber ?? '';
    const last4 = number.slice(-4);
    const ifsc = account.ifsc ?? '';
    return { last4, ifsc, upiMasked: null, masked: `XXXXXX${last4} · ${ifsc}` };
  }
  const upiMasked = maskUpi(account.upiId ?? '');
  return { last4: null, ifsc: null, upiMasked, masked: upiMasked };
}

interface SealedDetails {
  u: string;
  accountNumber?: string;
  ifsc?: string;
  upiId?: string;
}

export function sealDetails(account: NormalizedPayoutAccount, userId: string, key: Buffer): string {
  const body: SealedDetails = account.method === 'bank'
    ? { u: userId, accountNumber: account.accountNumber, ifsc: account.ifsc }
    : { u: userId, upiId: account.upiId };
  return seal(Buffer.from(JSON.stringify(body), 'utf8'), key);
}

/** Opens sealed details; throws when the key is wrong, the value was tampered with, or it belongs to someone else. */
export function openDetails(
  sealed: string, userId: string, key: Buffer, method: PayoutMethod, accountHolder: string,
): PayoutDestination {
  const body = JSON.parse(unseal(sealed, key).toString('utf8')) as SealedDetails;
  if (body.u !== userId) throw new Error('Sealed payout details belong to another user');
  return method === 'bank'
    ? { method, accountHolder, accountNumber: body.accountNumber, ifsc: body.ifsc }
    : { method, accountHolder, upiId: body.upiId };
}
