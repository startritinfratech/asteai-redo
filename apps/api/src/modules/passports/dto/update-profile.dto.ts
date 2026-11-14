import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** PATCH /passports/me/profile */
export class UpdatePassportProfileDto {
  @ApiPropertyOptional({ example: 'priya-menon' })
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/)
  slug?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) headline?: string;

  @ApiPropertyOptional({ enum: ['public', 'private'] }) @IsOptional() @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';
}
