import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeleteAccountDto {
  @ApiProperty({ description: 'The current password, to confirm' }) @IsString() @MaxLength(256) password: string;
}
