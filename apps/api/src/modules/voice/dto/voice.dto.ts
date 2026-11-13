import { IsString, Length, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TranslateDto {
  @ApiProperty() @IsString() @MaxLength(5000) text: string;
  @ApiProperty({ example: 'en' }) @IsString() @Length(2, 8) from: string;
  @ApiProperty({ example: 'hi' }) @IsString() @Length(2, 8) to: string;
}

export class DetectLanguageDto {
  @ApiProperty() @IsString() @MaxLength(5000) text: string;
}
