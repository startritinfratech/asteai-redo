import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UpdateShareDto } from './dto/update-share.dto';
import { PassportsService } from './passports.service';

@ApiTags('passports')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('passports')
export class PassportsController {
  constructor(private readonly svc: PassportsService) {}

  @Get('me')
  myPassports(@CurrentUser() user: User) {
    return this.svc.findForUser(user.id);
  }

  @Get('verify')
  verify(@Query('hash') hash: string) {
    return this.svc.verify(hash);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.findById(id, user);
  }

  @Patch(':id/share')
  updateShare(@Param('id') id: string, @Body() body: UpdateShareDto, @CurrentUser() user: User) {
    return this.svc.updateShare(id, body, user);
  }

  @Post(':id/verify')
  @Roles('Employer', 'Buyer', 'Admin')
  addVerification(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.addVerification(id, user);
  }
}
