import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@asteai/types';

/** Same rule as RegisterDto (at least 8 characters), with an upper bound against huge bodies. */
function PasswordRules(): PropertyDecorator {
  return (target, key) => {
    IsString()(target, key);
    MinLength(PASSWORD_MIN_LENGTH)(target, key);
    MaxLength(PASSWORD_MAX_LENGTH)(target, key);
  };
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

export class ForgotPasswordDto {
  @ApiProperty() @IsEmail() @MaxLength(255) email: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @Matches(TOKEN_RE, { message: 'Invalid token' }) token: string;
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH }) @PasswordRules() password: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MaxLength(PASSWORD_MAX_LENGTH) currentPassword: string;
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH }) @PasswordRules() newPassword: string;
}

export class VerifyEmailDto {
  @ApiProperty() @IsString() @Matches(TOKEN_RE, { message: 'Invalid token' }) token: string;
}

export class TwoFactorCodeDto {
  @ApiProperty({ example: '123456' }) @IsString() @Matches(/^\s*\d{3}\s?\d{3}\s*$/, { message: 'Enter the 6-digit code' }) code: string;
}

/** A 6-digit code or a backup code; exactly one is used (the code when both are sent). */
export class SecondFactorDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(6, 8) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(8, 40) backupCode?: string;
}

export class TwoFactorLoginDto extends SecondFactorDto {
  @ApiProperty() @IsString() @MaxLength(2000) challenge: string;
}

export class DisableTwoFactorDto extends SecondFactorDto {
  @ApiProperty() @IsString() @MaxLength(PASSWORD_MAX_LENGTH) password: string;
}
