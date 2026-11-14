import {
  ArrayMaxSize, IsString, IsNumber, IsEnum, IsInt, IsOptional, IsArray, Length, Max, MaxLength, Min,
  Validate, ValidateNested, ValidatorConstraint, ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CandidateTier } from '@asteai/types';
import { RubricCriterionDto, ScreeningQuestionDto } from './screening.dto';

/** deeptech_ai expects whole-number weights that add up to exactly 100. */
@ValidatorConstraint({ name: 'weightsSumTo100' })
export class WeightsSumTo100 implements ValidatorConstraintInterface {
  validate(w: unknown): boolean {
    if (!w || typeof w !== 'object') return false;
    const { iq, eq, grit } = w as Record<string, unknown>;
    return [iq, eq, grit].every((v) => Number.isInteger(v)) && (iq as number) + (eq as number) + (grit as number) === 100;
  }

  defaultMessage(): string {
    return 'weights.iq, weights.eq and weights.grit must be whole numbers that add up to 100';
  }
}

export class WeightsDto {
  @IsInt() @Min(0) @Max(100) iq: number;
  @IsInt() @Min(0) @Max(100) eq: number;
  @IsInt() @Min(0) @Max(100) grit: number;
}

export class CreateRequisitionDto {
  @ApiProperty() @IsString() @Length(1, 200) title: string;
  @ApiProperty() @IsString() @Length(1, 80) industry: string;
  @ApiProperty() @IsString() @Length(1, 80) func: string;
  @ApiProperty({ minimum: 1, maximum: 6 }) @IsInt() @Min(1) @Max(6) echLevel: number;

  @ApiProperty({ enum: ['Technical', 'Non-Technical', 'Frontline', 'Skilled'] })
  @IsEnum(['Technical', 'Non-Technical', 'Frontline', 'Skilled'])
  tier: CandidateTier;

  @ApiProperty() @ValidateNested() @Type(() => WeightsDto) @Validate(WeightsSumTo100) weights: WeightsDto;

  @ApiProperty() @IsString() @Length(1, 40) lang: string;
  @ApiProperty() @IsOptional() @IsString() @MaxLength(120) location?: string;
  @ApiProperty({ default: 1 }) @IsInt() @Min(1) @Max(10_000) headcount: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) @Max(1000) minShortlist?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(10) threshold?: number;

  @ApiProperty({ type: [String], required: false })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(80, { each: true })
  stack?: string[];

  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(10_000) brief?: string;

  /** Asked of applicants (e.g. from POST /ai/jobs/generate). */
  @ApiProperty({ type: [ScreeningQuestionDto], required: false })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ScreeningQuestionDto)
  screeningQuestions?: ScreeningQuestionDto[];

  /** Interview scoring rubric; weights are whole numbers summing to 100. */
  @ApiProperty({ type: [RubricCriterionDto], required: false })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => RubricCriterionDto)
  evaluationRubric?: RubricCriterionDto[];
}
