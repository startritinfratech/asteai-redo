import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Like AuthGuard('jwt'), but lets the request through without a user instead of 401. */
@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(_err: unknown, user: TUser | false): TUser | null {
    return user || null;
  }
}
