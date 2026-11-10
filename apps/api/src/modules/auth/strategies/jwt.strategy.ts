import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Pool } from 'pg';
import type { User, UserRole } from '@asteai/types';
import { DB_POOL } from '../../../database/database.module';
import { mapUserRow, USER_COLUMNS, UserRow } from '../../users/user.mapper';
import { ACCOUNT_ACTIVE_SQL, NOT_BLOCKED_SQL } from '../account-status';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  tenantId: string | null;
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
          AND (password_changed_at IS NULL OR date_trunc('second', password_changed_at) <= to_timestamp($2))`,
      [payload.sub, payload.iat ?? 0],
    );
    if (!rows.length) throw new UnauthorizedException();
    return mapUserRow(rows[0]);
  }
}
