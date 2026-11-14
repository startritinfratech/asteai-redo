import { Body, Controller, Delete, Get, Module, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested,
} from 'class-validator';
import type { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TalentPoolsService } from './talent-pools.service';

class ColumnDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z0-9_]{1,40}$/) key?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(40) label!: string;
}

export class CreatePoolDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional({ type: [ColumnDto] })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => ColumnDto)
  columns?: ColumnDto[];
}

export class UpdatePoolDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional({ type: [ColumnDto] })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => ColumnDto)
  columns?: ColumnDto[];
}

class ProspectDto {
  @ApiProperty() @IsString() @MaxLength(255) email!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) fullName?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) tags?: string[];
}

export class AddMembersDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z0-9_]{1,40}$/) column?: string;
  @ApiProperty({ type: [ProspectDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ProspectDto)
  members!: ProspectDto[];
}

export class MoveMemberDto {
  @ApiProperty() @Matches(/^[a-z0-9_]{1,40}$/) column!: string;
  /** The card that ends up just above this one (omit for the top). */
  @ApiPropertyOptional() @IsOptional() @IsString() beforeId?: string;
  /** The card that ends up just below this one (omit for the bottom). */
  @ApiPropertyOptional() @IsOptional() @IsString() afterId?: string;
}

export class UpdateMemberDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) tags?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) fullName?: string;
}

/** Talent CRM Kanban pools (company accounts). */
@ApiTags('talent-pools')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('Employer', 'Admin')
@Controller('talent-pools')
export class TalentPoolsController {
  constructor(private readonly svc: TalentPoolsService) {}

  @Get() list(@CurrentUser() u: User) { return this.svc.list(u); }
  @Post() create(@CurrentUser() u: User, @Body() dto: CreatePoolDto) { return this.svc.create(u, dto); }
  @Get(':id/board') board(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.board(u, id); }
  @Patch(':id') update(@CurrentUser() u: User, @Param('id') id: string, @Body() dto: UpdatePoolDto) { return this.svc.update(u, id, dto); }
  @Delete(':id') archive(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.archive(u, id); }

  @Post(':id/members')
  @Throttle({ short: { ttl: 60_000, limit: 20 } })
  addMembers(@CurrentUser() u: User, @Param('id') id: string, @Body() dto: AddMembersDto) { return this.svc.addMembers(u, id, dto); }

  @Patch(':id/members/:memberId/move')
  move(@CurrentUser() u: User, @Param('id') id: string, @Param('memberId') memberId: string, @Body() dto: MoveMemberDto) {
    return this.svc.moveMember(u, id, memberId, dto);
  }

  @Patch(':id/members/:memberId')
  updateMember(@CurrentUser() u: User, @Param('id') id: string, @Param('memberId') memberId: string, @Body() dto: UpdateMemberDto) {
    return this.svc.updateMember(u, id, memberId, dto);
  }

  @Delete(':id/members/:memberId')
  removeMember(@CurrentUser() u: User, @Param('id') id: string, @Param('memberId') memberId: string) {
    return this.svc.removeMember(u, id, memberId);
  }
}

@Module({
  controllers: [TalentPoolsController],
  providers: [TalentPoolsService],
  exports: [TalentPoolsService],
})
export class TalentPoolsModule {}
