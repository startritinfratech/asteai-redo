import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { APPLICATION_STAGES, ApplicationStage } from '@asteai/types';

export class AdvanceStageDto {
  @ApiProperty({ enum: APPLICATION_STAGES })
  @IsIn(APPLICATION_STAGES as readonly string[])
  stage: ApplicationStage;

  /** Display name recorded in the history; defaults to the acting user's name. */
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(120) by?: string;

  /**
   * The stage the caller saw. If the application has moved since (another recruiter),
   * the request is refused with 409 instead of skipping a step unseen.
   */
  @ApiProperty({ required: false, enum: APPLICATION_STAGES })
  @IsOptional() @IsIn(APPLICATION_STAGES as readonly string[])
  expectedStage?: ApplicationStage;

  /** Required when rejecting; kept in the history. */
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class AddScorecardDto {
  @ApiProperty({ minimum: 0, maximum: 10 }) @IsNumber() @Min(0) @Max(10) score: number;
  @ApiProperty() @IsString() @MaxLength(4000) note: string;
}
