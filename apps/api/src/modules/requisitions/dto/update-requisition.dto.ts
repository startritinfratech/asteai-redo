import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { REQ_STATUSES, ReqStatus } from '@asteai/types';
import { CreateRequisitionDto } from './create-requisition.dto';

export class UpdateRequisitionDto extends PartialType(CreateRequisitionDto) {
  @IsOptional()
  @IsIn(REQ_STATUSES as readonly string[])
  status?: ReqStatus;
}

/** POST /admin/requisitions/:id/approve|reject */
export class ReviewRequisitionDto {
  /** Required to reject (the owner sees it); optional to approve. */
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MinLength(3) @MaxLength(1000) note?: string;
}
