import { Type } from 'class-transformer';
import {
  IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { LANGUAGE_CODES } from '../catalogue';
import { INTERVIEW_MODES, type InterviewMode } from './rubrics';

/** POST /interviews/start */
export class StartStudioInterviewDto {
  /** `technical`: rubric interview for a tech field. `trades_voice`: voice-only, railway & trades roles. */
  @IsIn([...INTERVIEW_MODES]) mode!: InterviewMode;

  /** Tech field (technical) or frontline field from GET /interviews/catalogue (trades_voice). */
  @IsString() @MaxLength(120) domain!: string;

  /** The skill (technical) or the exact role label (trades_voice). */
  @IsString() @MinLength(2) @MaxLength(120) skill!: string;

  @IsOptional() @IsIn(LANGUAGE_CODES) language?: string;
}

class SpeechMetaDto {
  @IsOptional() @IsNumber() @Min(0) @Max(600_000) durationMs?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) confidence?: number;
}

/** POST /interviews/:id/turn */
export class StudioTurnDto {
  /** The answer as text: typed, or the speech-to-text transcript for voice. */
  @IsString() @MinLength(1) @MaxLength(4000) answer!: string;

  @IsIn(['text', 'voice']) inputMode!: 'text' | 'voice';

  @IsOptional() @IsIn(LANGUAGE_CODES) detectedLanguage?: string;

  @IsOptional() @ValidateNested() @Type(() => SpeechMetaDto) speech?: SpeechMetaDto;
}
