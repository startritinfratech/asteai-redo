import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PROJECT_STAGES, ProjectStage } from '@asteai/types';

export class MilestoneInputDto {
  @ApiProperty() @IsString() @MaxLength(200) name: string;
  @ApiProperty() @IsNumber() @Min(0) amount: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() dueDate?: number;
}

export class CreateProjectDto {
  @ApiProperty() @IsString() @MaxLength(200) title: string;
  @ApiProperty() @IsString() @MaxLength(120) domain: string;
  @ApiProperty() @IsNumber() @Min(0) budget: number;
  @ApiProperty() @IsString() @MaxLength(10_000) description: string;

  @ApiProperty({ type: [MilestoneInputDto], required: false })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => MilestoneInputDto)
  milestones?: MilestoneInputDto[];

  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() ndaRequired?: boolean;
}

export class UpdateProjectStageDto {
  @ApiProperty({ enum: PROJECT_STAGES }) @IsIn(PROJECT_STAGES as readonly string[]) stage: ProjectStage;
}

export class CreateDisputeDto {
  @ApiProperty() @IsString() @MaxLength(32) projectId: string;
  @ApiProperty() @IsUUID() raisedAgainst: string;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(4000) reason: string;
}

export class ResolveDisputeDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) resolution: string;
}
