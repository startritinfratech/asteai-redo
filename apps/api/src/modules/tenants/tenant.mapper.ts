import type { Tenant } from '@asteai/types';

export interface TenantRow {
  id: string;
  name: string;
  industry: string;
  plan: string;
  credits: number;
  seats: number;
  domain: string | null;
  retention_months: number;
  sso_enabled: boolean;
}

export function mapTenantRow(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    industry: row.industry,
    plan: row.plan as Tenant['plan'],
    credits: Number(row.credits),
    seats: Number(row.seats),
    domain: row.domain ?? '',
    retentionMonths: Number(row.retention_months),
    ssoEnabled: row.sso_enabled,
  };
}
