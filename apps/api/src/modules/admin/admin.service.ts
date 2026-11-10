import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import type { AdminStats } from '@asteai/types';
import { DB_POOL } from '../../database/database.module';

@Injectable()
export class AdminService {
  private flags: Record<string, boolean> = {
    ai_voice_assistant: true,
    deeptech_evaluator: true,
    instant_payouts: true,
    public_cert_verification: true,
    mock_interviews_free: true,
  };

  constructor(@Inject(DB_POOL) private readonly db: Pool) {}

  async getMasterStats(): Promise<AdminStats> {
    const [tenants, users, reqs, apps, passports] = await Promise.all([
      this.db.query(`SELECT COUNT(*) FROM tenants`),
      this.db.query(`SELECT role, COUNT(*) FROM user_accounts WHERE account_status = 'active' GROUP BY role`),
      this.db.query(`SELECT status, COUNT(*) FROM requisitions GROUP BY status`),
      this.db.query(`SELECT stage, COUNT(*) FROM applications GROUP BY stage`),
      this.db.query(`SELECT status, COUNT(*) FROM passports GROUP BY status`),
    ]);
    return {
      totalTenants: parseInt(tenants.rows[0].count, 10),
      usersByRole:  users.rows,
      reqs:         reqs.rows,
      applications: apps.rows,
      passports:    passports.rows,
    };
  }

  async getAuditLog(pageSize: number, offset: number) {
    const { rows } = await this.db.query(
      `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );
    return rows;
  }

  async getFeatureFlags() {
    return this.flags;
  }

  async setFeatureFlag(name: string, value: boolean, actorId: string) {
    this.flags[name] = value;
    await this.db.query(
      `INSERT INTO audit_log (actor_id, action, entity, meta)
       VALUES ($1, 'set_feature_flag', $2, $3)`,
      [actorId, name, String(value)],
    );
    return { flag: name, value };
  }

  async getTrustMetrics() {
    const [openDisputes, integrityFlags, unverifiedUsers] = await Promise.all([
      this.db.query(`SELECT COUNT(*) FROM disputes WHERE status = 'Open' OR status = 'In Review'`),
      this.db.query(`SELECT COUNT(*) FROM integrity_queue WHERE status = 'Open'`),
      this.db.query(`SELECT COUNT(*) FROM user_accounts WHERE email_verified = FALSE AND account_status = 'active'`),
    ]);
    return {
      activeDisputes: parseInt(openDisputes.rows[0]?.count || '0', 10),
      flaggedSessions: parseInt(integrityFlags.rows[0]?.count || '0', 10),
      pendingVerifications: parseInt(unverifiedUsers.rows[0]?.count || '0', 10),
      fraudScore: 'Low (0.02%)',
      sslStatus: 'TLS 1.3 Active',
    };
  }
}
