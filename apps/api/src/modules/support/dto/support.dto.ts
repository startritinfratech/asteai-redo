import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TICKET_STATUSES, type TicketStatus } from '@asteai/types';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTicketDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 40) categoryId: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200) subject: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 5000) body: string;
}

export class TicketMessageDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 5000) body: string;
}

export class AdminTicketsQueryDto {
  @ApiPropertyOptional({ enum: TICKET_STATUSES }) @IsOptional() @IsIn(TICKET_STATUSES as readonly string[]) status?: TicketStatus;
}

export class AdminUpdateTicketDto {
  @ApiPropertyOptional({ enum: TICKET_STATUSES }) @IsOptional() @IsIn(TICKET_STATUSES as readonly string[]) status?: TicketStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assigneeId?: string;
}
