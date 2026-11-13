import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateShareDto {
  @ApiProperty() @IsBoolean() discoverable: boolean;
  @ApiProperty() @IsBoolean() showIdentity: boolean;
}
