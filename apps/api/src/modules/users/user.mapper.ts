import type { AccountStatus, User, UserRole } from '@asteai/types';

/** The user_accounts columns every public User view is built from. */
export const USER_COLUMNS = `id, email, first_name, last_name, role, tenant_id, title,
  avatar_url, preferred_language, account_status, email_verified, created_at, updated_at`;

export interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: UserRole;
  tenant_id: string | null;
  title: string | null;
  avatar_url: string | null;
  preferred_language?: string | null;
  account_status: AccountStatus;
  email_verified: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : String(v));

export function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    role: row.role,
    tenantId: row.tenant_id,
    title: row.title ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    lang: row.preferred_language ?? undefined,
    accountStatus: row.account_status,
    emailVerified: Boolean(row.email_verified),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
