import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { paginate } from '../../common/utils/pagination';
import { InvoicesService } from './invoices.service';

/**
 * Invoices for captured escrow payments. The buyer and the expert of the contract see
 * theirs; admins see all. Invoices are created by InvoicesService.createForCapturedPayment
 * when a payment is captured, never through this controller.
 */
@ApiTags('invoices')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly svc: InvoicesService) {}

  @Get()
  list(@CurrentUser() user: User, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.svc.list(user, paginate(page, pageSize, 50));
  }

  @Get(':id')
  findOne(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.findOne(user, id);
  }

  @Get(':id/pdf')
  async pdf(@CurrentUser() user: User, @Param('id') id: string, @Res() res: Response) {
    const { invoice, pdf } = await this.svc.pdf(user, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoice.id}.pdf"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'private, no-store',
    });
    res.send(pdf);
  }
}
