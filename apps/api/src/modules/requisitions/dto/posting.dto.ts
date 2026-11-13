import { Transform } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, Length, Matches, MaxLength, Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EMPLOYMENT_TYPES, JOB_LOCATION_TYPES, type EmploymentType, type JobLocationType } from '@asteai/types';

const list = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter((v) => v !== '') : value;

/** Partial update of a requisition's public job-board settings; omitted fields keep their value. */
export class RequisitionPostingDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublic?: boolean;
  @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES }) @IsOptional() @IsIn(EMPLOYMENT_TYPES as readonly string[]) employmentType?: EmploymentType;
  @ApiPropertyOptional({ enum: JOB_LOCATION_TYPES }) @IsOptional() @IsIn(JOB_LOCATION_TYPES as readonly string[]) locationType?: JobLocationType;
  /** null clears the value. */
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) salaryMin?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) salaryMax?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 3) @Matches(/^[A-Z]{3}$/) salaryCurrency?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @Transform(list) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(200, { each: true })
  requirements?: string[];
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsDateString() expiresAt?: string | null;
}
