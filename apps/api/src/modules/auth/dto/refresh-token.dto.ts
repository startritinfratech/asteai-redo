import { IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiProperty() @IsString() @MaxLength(200) refreshToken: string;
}
