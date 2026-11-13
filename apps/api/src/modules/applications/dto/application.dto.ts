import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { APPLICATION_STAGES, ApplicationStage } from '@asteai/types';

export class AdvanceStageDto {
  @ApiProperty({ enum: APPLICATION_STAGES })
  @IsIn(APPLICATION_STAGES as readonly string[])
  stage: ApplicationStage;

  /** Display name recorded in the history; defaults to the acting user's name. */
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(120) by?: string;
}

export class AddScorecardDto {
  @ApiProperty({ minimum: 0, maximum: 10 }) @IsNumber() @Min(0) @Max(10) score: number;
  @ApiProperty() @IsString() @MaxLength(4000) note: string;
}
