import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SowMilestoneDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1e10) amount: number;
  @ApiProperty() @IsInt() @Min(1) @Max(3650) dueInDays: number;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(300, { each: true }) acceptanceCriteria: string[];
}

/** A statement of work: what will be delivered, when, for how much, and what's out of scope. */
export class StatementOfWorkDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(4000) scope: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(300, { each: true }) deliverables: string[];
  @ApiProperty({ type: [SowMilestoneDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => SowMilestoneDto)
  milestones: SowMilestoneDto[];
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(300, { each: true }) assumptions: string[];
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(300, { each: true }) outOfScope: string[];
  @ApiProperty() @IsInt() @Min(0) @Max(20) revisionRounds: number;
}

export class SubmitProposalDto {
  @ApiProperty() @IsString() @MaxLength(32) projectId: string;
  @ApiProperty() @IsNumber() @Min(0) price: number;
  @ApiProperty() @IsInt() @Min(1) @Max(3650) days: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(4000) note?: string;
  /** Optional SOW; its milestone amounts must add up to `price`, all due within `days`. */
  @ApiProperty({ required: false, type: StatementOfWorkDto })
  @IsOptional() @ValidateNested() @Type(() => StatementOfWorkDto)
  sow?: StatementOfWorkDto;
}
