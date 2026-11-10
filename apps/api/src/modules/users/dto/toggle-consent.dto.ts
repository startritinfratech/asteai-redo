import { IsBoolean, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ToggleConsentDto {
  @ApiProperty() @IsString() @Length(1, 64) purpose: string;
  @ApiProperty() @IsBoolean() active: boolean;
}
