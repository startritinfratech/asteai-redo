import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { ScreeningQuestionType } from '@asteai/types';

const QUESTION_TYPES: ScreeningQuestionType[] = ['yes_no', 'short_text', 'multiple_choice', 'number'];

export class ScreeningQuestionDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(300) question!: string;
  @ApiProperty({ enum: QUESTION_TYPES }) @IsIn(QUESTION_TYPES) type!: ScreeningQuestionType;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(120, { each: true }) options!: string[];
  @ApiProperty() @IsBoolean() knockout!: boolean;
  @ApiProperty() @IsString() @MaxLength(500) idealAnswer!: string;
}

export class RubricCriterionDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) criterion!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100) weight!: number;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) @MaxLength(200, { each: true }) strongSignals!: string[];
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) @MaxLength(200, { each: true }) weakSignals!: string[];
}
