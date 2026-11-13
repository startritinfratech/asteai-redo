import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Pool } from 'pg';
import type { User, UserRole } from '@asteai/types';
import { DB_POOL } from '../../../database/database.module';
import { mapUserRow, USER_COLUMNS, UserRow } from '../../users/user.mapper';
import { ACCOUNT_ACTIVE_SQL, NOT_BLOCKED_SQL, tokenIssueParams, tokenNotRevokedSql } from '../account-status';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  tenantId: string | null;
  /**
   * Issue time in milliseconds (the standard `iat` is whole seconds), so a password change
   * revokes a token minted earlier in the same second. Absent on older tokens.
   */
  iatMs?: number;
}

/**
 * Validates the bearer access token and loads the (still active, not banned or suspended)
 * user onto `request.user`, so a ban takes effect on the next request.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @Inject(DB_POOL) private readonly db: Pool,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      ignoreExpiration: false,
    });
  }

  /**
   * Also refuses tokens that carry a `purpose` claim (e.g. a 2FA login challenge, which is
   * signed with a different key anyway) and access tokens issued before the password was
   * last changed or reset, so a password change signs out other devices at once.
   */
  async validate(payload: JwtPayload & { purpose?: unknown; iat?: number }): Promise<User> {
    if (payload.purpose !== undefined || typeof payload.sub !== 'string') throw new UnauthorizedException();
    const { rows } = await this.db.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM user_accounts
        WHERE id = $1 AND ${ACCOUNT_ACTIVE_SQL} AND ${NOT_BLOCKED_SQL}
          AND ${tokenNotRevokedSql(2, 3)}`,
      [payload.sub, ...tokenIssueParams(payload)],
    );

    if (!rows.length) throw new UnauthorizedException();
    return mapUserRow(rows[0]);
  }
}
