import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminTicketsQueryDto, AdminUpdateTicketDto, CreateTicketDto, TicketMessageDto } from './dto/support.dto';
import { SupportService } from './support.service';

@ApiTags('support')
@Controller('support')
export class SupportController {
  constructor(private readonly svc: SupportService) {}

  @Get('categories')
  @Header('Cache-Control', 'public, max-age=300, s-maxage=300')
  @ApiOperation({ summary: 'Help-desk categories (public)' })
  categories() {
    return this.svc.categories();
  }

  @Get('tickets')
  @ApiBearerAuth() @UseGuards(AuthGuard('jwt'))
  mine(@CurrentUser() user: User) {
    return this.svc.mine(user);
  }

  @Post('tickets')
  @ApiBearerAuth() @UseGuards(AuthGuard('jwt'))
  @Throttle({ short: { ttl: 60_000, limit: 5 } })
  create(@Body() dto: CreateTicketDto, @CurrentUser() user: User) {
    return this.svc.create(dto, user);
  }

  @Get('tickets/:id')
  @ApiBearerAuth() @UseGuards(AuthGuard('jwt'))
  get(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.get(id, user);
  }

  @Post('tickets/:id/messages')
  @ApiBearerAuth() @UseGuards(AuthGuard('jwt'))
  @Throttle({ short: { ttl: 60_000, limit: 20 } })
  reply(@Param('id') id: string, @Body() dto: TicketMessageDto, @CurrentUser() user: User) {
    return this.svc.reply(id, dto.body, user);
  }

  @Post('tickets/:id/resolve') @HttpCode(HttpStatus.OK)
  @ApiBearerAuth() @UseGuards(AuthGuard('jwt'))
  resolve(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.resolveOwn(id, user);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('Admin')
@Controller('admin/support/tickets')
export class AdminSupportController {
  constructor(private readonly svc: SupportService) {}

  @Get()
  list(@Query() q: AdminTicketsQueryDto) {
    return this.svc.adminList(q.status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.adminGet(id);
  }

  @Post(':id/messages')
  reply(@Param('id') id: string, @Body() dto: TicketMessageDto, @CurrentUser() user: User) {
    return this.svc.staffReply(id, dto.body, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: AdminUpdateTicketDto) {
    return this.svc.adminUpdate(id, dto);
  }
}
