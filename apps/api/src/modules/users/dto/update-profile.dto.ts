import { IsOptional, IsString, IsUrl, Length, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(1, 100) firstName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(1, 100) lastName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) title?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUrl({ protocols: ['https'] }) avatarUrl?: string;
  @ApiProperty({ required: false, example: 'en' }) @IsOptional() @IsString() @Length(2, 8) lang?: string;
}
