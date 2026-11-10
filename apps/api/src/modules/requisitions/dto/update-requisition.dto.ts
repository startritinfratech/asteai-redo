import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsIn } from 'class-validator';
import { REQ_STATUSES, ReqStatus } from '@asteai/types';
import { CreateRequisitionDto } from './create-requisition.dto';

export class UpdateRequisitionDto extends PartialType(CreateRequisitionDto) {
  @IsOptional()
  @IsIn(REQ_STATUSES as readonly string[])
  status?: ReqStatus;
}
