import { Body, Controller, Get, HttpCode, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { RESUME_MAX_BYTES, RESUME_MIME_TYPES, type User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ChargeCredits, CreditChargeInterceptor } from '../credits/charge-credits';
import { ResumesService } from './resumes.service';

export class CreateResumeUploadDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(200) fileName!: string;
  @ApiProperty({ enum: Object.values(RESUME_MIME_TYPES) }) @IsIn(Object.values(RESUME_MIME_TYPES)) contentType!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(RESUME_MAX_BYTES) sizeBytes!: number;
}

@ApiTags('resumes')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('resumes')
export class ResumesController {
  constructor(private readonly svc: ResumesService) {}

  @Get('me')
  latest(@CurrentUser() user: User) {
    return this.svc.latest(user.id);
  }

  @Post('upload-url')
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Presigned S3 PUT for a PDF/DOCX résumé (≤ 5 MB, valid 5 minutes)' })
  createUpload(@CurrentUser() user: User, @Body() dto: CreateResumeUploadDto) {
    return this.svc.createUpload(user.id, dto);
  }

  /** AI Resume Autofill: the `expert_autofill` credit price, refunded if it fails. */
  @Post(':id/autofill')
  @HttpCode(200)
  @Throttle({ short: { ttl: 60_000, limit: 3 } })
  @UseInterceptors(CreditChargeInterceptor)
  @ChargeCredits('expert_autofill')
  @ApiOperation({ summary: 'Read an uploaded résumé and return a profile draft to review' })
  autofill(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.autofill(user.id, id);
  }
}
