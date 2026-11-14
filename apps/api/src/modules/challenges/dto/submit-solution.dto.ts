import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CHALLENGE_LANGUAGES } from '../code-runner';

/** POST /challenges/:id/submissions */
export class SubmitSolutionDto {
  @ApiProperty({ enum: CHALLENGE_LANGUAGES }) @IsIn([...CHALLENGE_LANGUAGES]) language: string;

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(65_536) source: string;

  /**
   * Editor telemetry (durationMs, timeToFirstKeystrokeMs, keystrokes, pasteCount,
   * pastedChars, tabSwitches, runCount). Stored for review; never changes the score.
   */
  @ApiPropertyOptional() @IsOptional() @IsObject() telemetry?: Record<string, unknown>;
}
