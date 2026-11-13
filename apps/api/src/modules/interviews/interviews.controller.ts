import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UseGuards, HttpCode,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { paginate } from '../../common/utils/pagination';
import { AiResultsKeyGuard } from '../../common/guards/ai-results-key.guard';
import { CertificatesService } from '../certificates/certificates.service';
import { catalogue } from './catalogue';
import { StartMockInterviewDto } from './dto/start-mock-interview.dto';
import { InterviewsService, type AiResultPayload } from './interviews.service';

@ApiTags('interviews')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('interviews')
export class InterviewsController {
  constructor(
    private readonly svc: InterviewsService,
    private readonly certificates: CertificatesService,
  ) {}

  /** Categories, fields, frontline roles and languages for the setup form. */
  @Get('catalogue')
  catalogue() {
    return catalogue();
  }

  @Post('mock')
  startMock(@CurrentUser() user: User, @Body() dto: StartMockInterviewDto) {
    return this.svc.startMock(user, dto);
  }

  @Get('mock')
  listMine(@CurrentUser() user: User) {
    return this.svc.listMine(user.id);
  }

  @Get('mock/:id')
  detail(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.detail(user, id);
  }

  /** A fresh AI token to reconnect to an interview that has not finished. Owner only. */
  @Post('mock/:id/session')
  session(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.session(user, id);
  }

  @Get('mock/:id/assessment')
  assessment(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.assessment(user, id);
  }

  @Get('mock/:id/certificate')
  async certificate(@CurrentUser() user: User, @Param('id') id: string, @Res() res: Response) {
    const row = await this.svc.owned(user, id);
    if (row.status !== 'completed') {
      res.status(409).json({ statusCode: 409, message: 'The certificate is available once the interview is complete' });
      return;
    }
    const pdf = await this.certificates.pdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="asteai-certificate-${id}.pdf"`,
      'Content-Length': String(pdf.length),
    });
    res.send(pdf);
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  @Get('admin/mock')
  @Roles('Admin')
  adminList(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('page') page?: string,
  ) {
    const allowed = ['in_progress', 'completed', 'abandoned'];
    // `limit` is the page size; an explicit `offset` wins over `page`.
    const p = paginate(page, limit, 50, 100);
    const skip = offset === undefined ? p.offset : Math.max(0, Math.floor(Number(offset)) || 0);
    return this.svc.adminList({
      status: allowed.includes(status ?? '') ? status : undefined, limit: p.pageSize, offset: skip,
    });
  }

  /** Rebuilds the certificate content (e.g. after the AI service was down). */
  @Post('admin/mock/:id/certificate')
  @Roles('Admin')
  async regenerate(@Param('id', new ParseUUIDPipe()) id: string) {
    const { content } = await this.certificates.ensureContent(id, true);
    return { certificateContent: content };
  }
}

/** deeptech_ai posts finished results here (deeptech_ai/results_sink.py). */
@ApiTags('internal')
@SkipThrottle()
@UseGuards(AiResultsKeyGuard)
@Controller('internal')
export class InternalResultsController {
  constructor(private readonly svc: InterviewsService) {}

  @Post('ai-results')
  @HttpCode(200)
  receive(@Body() body: { event?: unknown; data?: AiResultPayload }) {
    return this.svc.applyResult(String(body?.event ?? ''), body?.data ?? {});
  }
}
