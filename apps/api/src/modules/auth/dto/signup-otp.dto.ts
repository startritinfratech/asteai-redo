import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BotCheckDto } from '../../marketing/dto/marketing.dto';

const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class SendOtpDto extends BotCheckDto {
  @ApiProperty() @Transform(lowerTrim) @IsEmail() @MaxLength(254) email: string;
}

export class VerifyOtpDto {
  @ApiProperty() @Transform(lowerTrim) @IsEmail() @MaxLength(254) email: string;
  @ApiProperty({ example: '042917' }) @IsString() @Matches(/^\d{6}$/, { message: 'code must be 6 digits' }) code: string;
}
