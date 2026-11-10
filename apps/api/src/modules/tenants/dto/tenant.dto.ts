import {
  ArrayMaxSize, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Roles a tenant may invite. Admins are never created through the tenant team endpoint. */
export const TEAM_ROLES = ['Employer'] as const;

export class AddTeamMemberDto {
  @ApiProperty() @IsEmail() @MaxLength(255) email: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) firstName: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) lastName: string;
  @ApiProperty({ enum: TEAM_ROLES }) @IsIn(TEAM_ROLES as readonly string[]) role: (typeof TEAM_ROLES)[number];
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) title?: string;
}

export class CreatePoolDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000) count?: number;

  @ApiProperty({ type: [String], required: false })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(50, { each: true })
  tags?: string[];
}

export class CreateOutreachDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) channel: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000) sent?: number;
}

export class TopUpCreditsDto {
  @ApiProperty() @IsInt() @Min(1) @Max(1_000_000) amount: number;
}
