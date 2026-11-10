import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body of POST /auth/logout. With a valid bearer access token the body may be empty and
 * every refresh token of the user is revoked. Without one (e.g. the access token expired),
 * send the refresh token to revoke just that one.
 */
export class LogoutDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) refreshToken?: string;
}
