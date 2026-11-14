import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';

/**
 * JSON contracts of the credits API. Requests are validated DTOs (the global
 * ValidationPipe rejects unknown fields); responses are these plain shapes, so the web app
 * and the AI endpoints depend on the contract, not on table layouts.
 */

export {
  CREDIT_TX_TYPES, MAX_PACK_DISCOUNT, SUBSCRIPTION_TIERS,
} from '@asteai/types';
export type {
  CreditCharge, CreditPack, CreditTransactionView, CreditTxStatus, CreditTxType, InsufficientCreditsBody,
  SubscriptionCheckout, SubscriptionTier, TopupCheckout, TopupVerifyResult, WalletView,
} from '@asteai/types';

// ── Requests ──────────────────────────────────────────────────────────────────

export class CreateTopupDto {
  @ApiProperty({ example: 'standard' }) @IsString() @Matches(/^[a-z0-9_-]{1,40}$/) packId: string;
}

export class VerifyTopupDto {
  @ApiProperty() @IsString() @MaxLength(64) orderId: string;
  @ApiProperty() @IsString() @MaxLength(64) paymentId: string;
  @ApiProperty() @IsString() @MaxLength(256) signature: string;
}

export class CreateSubscriptionDto {
  @ApiProperty({ enum: ['pro'] }) @IsIn(['pro']) tier: 'pro';
}
