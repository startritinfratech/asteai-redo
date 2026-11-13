import type { CandidateTier, Passport, PassportStatus } from '@asteai/types';

export interface PassportRow {
  id: string;
  user_id: string;
  name: string;
  tier: CandidateTier;
  scores: Array<[string, number]> | null;
  sten_iq: string | number | null;
  sten_eq: string | number | null;
  sten_grit: string | number | null;
  percentile: string | number | null;
  hash: string | null;
  issued_at: Date | string;
  valid_until: Date | string | null;
  status: PassportStatus;
  discoverable: boolean;
  show_identity: boolean;
  verifications: Array<{ t: number; by: string }> | null;
  holder_name?: string;
}

// pg returns NUMERIC columns as strings.
const num = (v: string | number | null) => (v === null ? 0 : Number(v));
const ms = (v: Date | string | null) => (v === null ? 0 : new Date(v).getTime());

export function mapPassportRow(row: PassportRow): Passport & { holderName?: string } {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    tier: row.tier,
    scores: row.scores ?? [],
    sten: { iq: num(row.sten_iq), eq: num(row.sten_eq), grit: num(row.sten_grit) },
    percentile: num(row.percentile),
    hash: row.hash ?? '',
    issuedAt: ms(row.issued_at),
    validUntil: ms(row.valid_until),
    status: row.status,
    share: { discoverable: row.discoverable, showIdentity: row.show_identity },
    verifications: row.verifications ?? [],
    holderName: row.holder_name,
  };
}
