import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Length, Matches, MaxLength, ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VOICE_TARGET_KINDS, type VoiceTargetKind } from '@asteai/types';

export class VoiceTargetDto {
  @ApiProperty({ example: 'route:requisitions' })
  @IsString() @Matches(/^[a-z]+:[a-z0-9/_.-]{1,80}$/i) id: string;

  @ApiProperty({ enum: VOICE_TARGET_KINDS })
  @IsIn(VOICE_TARGET_KINDS) kind: VoiceTargetKind;

  @ApiProperty() @IsString() @Length(1, 80) label: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() confirm?: boolean;
}

export class VoiceCommandDto {
  @ApiProperty({ example: 'open my requisitions' })
  @IsString() @Length(1, 500) utterance: string;

  @ApiProperty({ example: '/platform/applications' })
  @IsString() @Matches(/^\/[\w\-/]*$/) @MaxLength(200) pathname: string;

  @ApiPropertyOptional({ example: 'en-IN' })
  @IsOptional() @IsString() @Length(2, 16) language?: string;

  @ApiProperty({ type: [VoiceTargetDto] })
  @IsArray() @ArrayMaxSize(150) @ValidateNested({ each: true }) @Type(() => VoiceTargetDto)
  targets: VoiceTargetDto[];
}
