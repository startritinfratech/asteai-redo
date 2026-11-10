import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, Matches, Max,
  MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CONTRACT_STATUSES, ENGAGEMENT_MODELS, type ContractStatus, type EngagementModel } from '../contract.types';

export class ContractMilestoneInputDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1e10) amount: number;
  @ApiProperty({ required: false, example: '2026-12-31' })
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dueDate must be YYYY-MM-DD' }) dueDate?: string;
}

export class CreateContractDto {
  @ApiProperty() @IsString() @MaxLength(32) proposalId: string;
  @ApiProperty({ enum: ENGAGEMENT_MODELS }) @IsIn(ENGAGEMENT_MODELS as readonly string[]) engagementModel: EngagementModel;

  /** Shape depends on engagementModel; checked by paymentTermsError in the service. */
  @ApiProperty({ type: Object }) @IsObject() paymentTerms: Record<string, unknown>;

  @ApiProperty({ required: false, default: 'INR' })
  @IsOptional() @Matches(/^[A-Z]{3}$/, { message: 'currency must be an ISO 4217 code' }) currency?: string;

  @ApiProperty({ type: [ContractMilestoneInputDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ContractMilestoneInputDto)
  milestones: ContractMilestoneInputDto[];

  @ApiProperty() @IsBoolean() ndaRequired: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(20_000) ndaText?: string;
}

export class ListContractsQueryDto {
  @ApiProperty({ required: false, enum: CONTRACT_STATUSES })
  @IsOptional() @IsIn(CONTRACT_STATUSES as readonly string[]) status?: ContractStatus;
  @ApiProperty({ required: false }) @IsOptional() @IsString() page?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() pageSize?: string;
}

export class SignContractDto {
  /** Must match the signer's account name (case-insensitive). */
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) signatureName: string;
}

export class DeclineContractDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

export class CancelContractDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(2000) reason: string;
}

export class MilestoneNoteDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) note: string;
}

export class CapturePaymentDto {
  /** The provider's payment reference (stand-in: the reference of the manually verified payment). */
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(128) providerPaymentId: string;
}
