import { ConflictException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import type { Tenant, User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { generateId } from '../../common/utils/ids';
import { issueEmailToken, TEAM_INVITE_TOKEN_TTL_MS } from '../auth/email-tokens';
import { EmailService } from '../email/email.service';
import { mapTenantRow, TenantRow } from './tenant.mapper';
import { AddTeamMemberDto, CreateOutreachDto, CreatePoolDto } from './dto/tenant.dto';

@Injectable()
export class TenantsService {
  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly email: EmailService,
  ) {}

  async findAll(): Promise<Tenant[]> {
    const { rows } = await this.db.query<TenantRow>(`SELECT * FROM tenants ORDER BY name`);
    return rows.map(mapTenantRow);
  }

  async findOne(id: string): Promise<Tenant> {
    const { rows } = await this.db.query<TenantRow>(`SELECT * FROM tenants WHERE id = $1`, [id]);
    if (!rows.length) throw new NotFoundException(`Tenant ${id} not found`);
    return mapTenantRow(rows[0]);
  }

  /** Adds `amount` (a positive integer, checked by the DTO) to the tenant's credit balance. */
  async updateCredits(id: string, amount: number): Promise<Tenant> {
    const { rows } = await this.db.query<TenantRow>(
      `UPDATE tenants SET credits = credits + $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [amount, id],
    );
    if (!rows.length) throw new NotFoundException();
    return mapTenantRow(rows[0]);
  }

  async getTeam(tenantId: string) {
    const { rows } = await this.db.query(
      `SELECT id, email, first_name, last_name, role, title, account_status, created_at
       FROM user_accounts
       WHERE tenant_id = $1
       ORDER BY created_at ASC`,
      [tenantId],
    );
    return rows;
  }

  /**
   * Creates a new team account. It never touches an existing account: if the email
   * (compared case-insensitively) is already registered the request is refused with 409,
   * so a tenant can't move someone else's account into its tenant or change its role.
   */
  /**
   * Creates a passwordless, unverified account on the tenant and, in the same transaction,
   * a single-use set-password link (a 'reset_password' token valid for 7 days) emailed as a
   * 'team-invite'. Setting the password through /auth/reset also verifies the address.
   * Never touches an existing account: an email already in use is a 409.
   */
  async addTeamMember(tenantId: string, member: AddTeamMemberDto, inviter: User) {
    return withTransaction(this.db, async (client) => {
      const { rows } = await client.query<{ id: string; email: string; first_name: string }>(
        `INSERT INTO user_accounts (email, email_canonical, first_name, last_name, role, title, tenant_id, auth_provider, account_status, email_verified)
         SELECT $1::varchar, LOWER($1::varchar), $2::varchar, $3::varchar, $4::user_role_enum, $5::text,
                $6::varchar, 'local', 'active', false
          WHERE NOT EXISTS (
            SELECT 1 FROM user_accounts WHERE LOWER(email) = LOWER($1::varchar) OR email_canonical = LOWER($1::varchar)
          )
         ON CONFLICT (email) DO NOTHING
         RETURNING id, email, first_name, last_name, role, title, account_status, created_at`,
        [member.email, member.firstName, member.lastName, member.role, member.title ?? '', tenantId],
      );
      if (!rows.length) throw new ConflictException('An account with this email already exists');
      const created = rows[0];

      const { rows: tenants } = await client.query<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [tenantId]);
      const token = await issueEmailToken(client, created.id, 'reset_password', TEAM_INVITE_TOKEN_TTL_MS);
      await this.email.enqueue(
        'team-invite',
        created.email,
        {
          inviterName: [inviter.firstName, inviter.lastName].filter(Boolean).join(' '),
          tenantName: tenants[0]?.name ?? '',
          firstName: created.first_name ?? '',
          path: `/auth/reset?token=${token}`,
        },
        { client, userId: created.id },
      );
      return created;
    });
  }


  async getPools(tenantId: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM talent_pools WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows;
  }

  async createPool(tenantId: string, pool: CreatePoolDto) {
    const { rows } = await this.db.query(
      `INSERT INTO talent_pools (id, tenant_id, name, count, tags)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [generateId('POOL'), tenantId, pool.name, pool.count ?? 0, pool.tags ?? []],
    );
    return rows[0];
  }

  async getOutreach(tenantId: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM outreach_campaigns WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows;
  }

  async createOutreach(tenantId: string, campaign: CreateOutreachDto) {
    const { rows } = await this.db.query(
      `INSERT INTO outreach_campaigns (id, tenant_id, name, channel, sent, status)
       VALUES ($1, $2, $3, $4, $5, 'Active')
       RETURNING *`,
      [generateId('OUT'), tenantId, campaign.name, campaign.channel, campaign.sent ?? 50],
    );
    return rows[0];
  }
}
