import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MESSAGE_MAX_LENGTH } from '../chat.types';

export class StartChatDto {
  @ApiProperty({ description: 'The other person in the chat' })
  @IsUUID() userId: string;

  @ApiPropertyOptional({ description: 'Project the conversation is about (buyer ↔ freelancer)' })
  @IsOptional() @IsString() @MaxLength(32) projectId?: string;
}

export class ListMessagesQueryDto {
  @ApiPropertyOptional({ description: 'Cursor: return messages older than this (the previous page\'s nextBefore)' })
  @IsOptional() @IsISO8601({ strict: true }) before?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 30 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class SendMessageDto {
  /** Trimmed by the service; empty bodies are rejected there. */
  @ApiProperty({ maxLength: MESSAGE_MAX_LENGTH })
  @IsString() @MaxLength(MESSAGE_MAX_LENGTH + 200) body: string;
}
