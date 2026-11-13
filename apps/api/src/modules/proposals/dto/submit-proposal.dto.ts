import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitProposalDto {
  @ApiProperty() @IsString() @MaxLength(32) projectId: string;
  @ApiProperty() @IsNumber() @Min(0) price: number;
  @ApiProperty() @IsInt() @Min(1) @Max(3650) days: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(4000) note?: string;
}
