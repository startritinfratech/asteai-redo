import {
  CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { catchError, from, mergeMap, Observable, throwError } from 'rxjs';
import type { User } from '@asteai/types';
import type { CreditCharge } from './credits.contracts';
import { CreditsService } from './credits.service';

export const CHARGE_CREDITS = 'credits:charge';

export interface ChargeCreditsOptions {
  featureKey: string;
  /** Fixed cost; otherwise the feature's credit_costs price. */
  cost?: number;
}

/**
 * Meters an AI endpoint. Use after the JWT guard:
 *
 *   @UseGuards(AuthGuard('jwt'))
 *   @UseInterceptors(CreditChargeInterceptor)
 *   @ChargeCredits('ai_search')
 *   @Post('search') search(@Body() dto: SearchDto) { ... }
 *
 * The handler only runs once the credits are taken (402 otherwise); if it throws, the
 * charge is refunded and the error goes on to the client unchanged. The handler can read
 * the charge from `req.creditCharge`; the new balance is sent as `X-Credits-Balance`.
 */
export const ChargeCredits = (featureKey: string, cost?: number) =>
  SetMetadata(CHARGE_CREDITS, { featureKey, cost } satisfies ChargeCreditsOptions);

export type MeteredRequest = Request & { user?: User; creditCharge?: CreditCharge };

@Injectable()
export class CreditChargeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly credits: CreditsService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const opts = this.reflector.get<ChargeCreditsOptions | undefined>(CHARGE_CREDITS, ctx.getHandler());
    if (!opts) return next.handle();

    const req = ctx.switchToHttp().getRequest<MeteredRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    if (!req.user?.id) throw new UnauthorizedException();

    const cost = opts.cost ?? (await this.credits.costOf(opts.featureKey));
    const charge = await this.credits.consumeCredits(req.user.id, cost, opts.featureKey);
    req.creditCharge = charge;
    res.setHeader?.('X-Credits-Balance', String(charge.balance));

    return next.handle().pipe(
      catchError((err: unknown) =>
        from(this.credits.refundAfterFailure(charge, err)).pipe(mergeMap(() => throwError(() => err)))),
    );
  }
}
