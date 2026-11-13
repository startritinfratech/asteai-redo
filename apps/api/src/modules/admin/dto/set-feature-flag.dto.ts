import { IsBoolean, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetFeatureFlagDto {
  @ApiProperty() @IsString() @MaxLength(64) @Matches(/^[a-z0-9_.-]+$/i) name: string;
  @ApiProperty() @IsBoolean() value: boolean;
}
