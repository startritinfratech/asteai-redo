import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUrl, IsUUID, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  DISPUTE_LIMITS, DISPUTE_REASON_CODES, DISPUTE_RESOLUTIONS, DISPUTE_STATUSES,
  type DisputeReasonCode, type DisputeResolution, type DisputeStatus,
} from '@asteai/types';

/** POST /contracts/:id/milestones/:mid/dispute (the contract and milestone come from the path). */
export class MilestoneDisputeDto {
  @ApiProperty({ enum: DISPUTE_REASON_CODES })
  @IsIn(DISPUTE_REASON_CODES as readonly string[]) reasonCode: DisputeReasonCode;

  @ApiProperty() @IsString() @MinLength(10) @MaxLength(DISPUTE_LIMITS.description) description: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1e10) amountInDispute?: number;
}

/** POST /disputes */
export class CreateDisputeDto {
  @ApiProperty() @IsString() @MaxLength(32) contractId: string;

  /** Omit for a dispute about the contract as a whole. */
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() milestoneId?: string;

  @ApiProperty({ enum: DISPUTE_REASON_CODES })
  @IsIn(DISPUTE_REASON_CODES as readonly string[]) reasonCode: DisputeReasonCode;

  @ApiProperty() @IsString() @MinLength(10) @MaxLength(DISPUTE_LIMITS.description) description: string;

  /** At most the escrow held on the milestone (or on the contract). */
  @ApiProperty({ required: false })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1e10) amountInDispute?: number;
}

export class ListDisputesQueryDto {
  @ApiProperty({ required: false, enum: DISPUTE_STATUSES })
  @IsOptional() @IsIn(DISPUTE_STATUSES as readonly string[]) status?: DisputeStatus;
  @ApiProperty({ required: false }) @IsOptional() @IsString() page?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() pageSize?: string;
}

/** POST /disputes/:id/messages */
export class DisputeMessageDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(DISPUTE_LIMITS.message) body: string;

  /** https links only, at most 10. */
  @ApiProperty({ required: false, type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(DISPUTE_LIMITS.evidenceLinks)
  @IsString({ each: true }) @MaxLength(DISPUTE_LIMITS.evidenceLinkLength, { each: true })
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true, message: 'Evidence links must be https URLs' })
  evidenceLinks?: string[];

  /** Admins only: an internal note the parties never see. */
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() internal?: boolean;
}

/** POST /disputes/:id/resolve (Admin) */
export class ResolveDisputeDto {
  @ApiProperty({ enum: DISPUTE_RESOLUTIONS })
  @IsIn(DISPUTE_RESOLUTIONS as readonly string[]) resolution: DisputeResolution;

  @ApiProperty() @IsString() @MinLength(3) @MaxLength(DISPUTE_LIMITS.message) note: string;

  /** split only. splitExpertAmount + splitBuyerAmount must equal the escrow held. */
  @ApiProperty({ required: false })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1e10) splitExpertAmount?: number;
  @ApiProperty({ required: false })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1e10) splitBuyerAmount?: number;
}
