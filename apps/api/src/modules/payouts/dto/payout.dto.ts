import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PAYOUT_METHODS, PAYOUT_STATUSES, type PayoutMethod, type PayoutStatus } from '../../ledger/billing-types';

/** Shapes only; parsePayoutAccount (payout-account.ts) checks IFSC / account number / UPI formats. */
export class PayoutAccountDto {
  @ApiProperty({ enum: PAYOUT_METHODS }) @IsIn(PAYOUT_METHODS as readonly string[]) method: PayoutMethod;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) accountHolder: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(32) accountNumber?: string;
  @ApiProperty({ required: false, example: 'HDFC0001234' }) @IsOptional() @IsString() @MaxLength(16) ifsc?: string;
  @ApiProperty({ required: false, example: 'name@okhdfc' }) @IsOptional() @IsString() @MaxLength(100) upiId?: string;
}

export class RequestPayoutDto {
  @ApiProperty({ description: 'INR, at most two decimals' })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }) @Min(1) @Max(1e9) amount: number;
}

export class MarkPaidDto {
  @ApiProperty({ description: 'Bank UTR or UPI reference of the transfer' })
  @IsString() @Matches(/^\s*[A-Za-z0-9/-]{6,64}\s*$/, { message: 'reference must be 6-64 letters, digits, / or -' })
  reference: string;
}

export class RejectPayoutDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) note: string;
}

export class ListPayoutsQueryDto {
  @ApiProperty({ required: false, enum: PAYOUT_STATUSES })
  @IsOptional() @IsIn(PAYOUT_STATUSES as readonly string[]) status?: PayoutStatus;
  @ApiProperty({ required: false }) @IsOptional() @IsString() page?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() pageSize?: string;
}
