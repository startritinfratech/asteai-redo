import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { paginate } from '../../common/utils/pagination';
import { AdminProductsQueryDto, ListProductsQueryDto, ProductDto, ReviewProductDto } from './dto/product.dto';
import { ProductsService } from './products.service';

const AUTH = [AuthGuard('jwt'), RolesGuard] as const;

/** /products: the public catalogue plus the seller's own listings (`mine` is declared before `:slug`). */
@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly svc: ProductsService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60, s-maxage=60')
  @Throttle({ short: { ttl: 60_000, limit: 120 } })
  @ApiOperation({ summary: 'Public catalogue of active products' })
  list(@Query() q: ListProductsQueryDto) {
    return this.svc.list({ q: q.q || undefined, category: q.category || undefined }, paginate(q.page, q.pageSize, 24, 60));
  }

  @Get('mine')
  @ApiBearerAuth() @UseGuards(...AUTH) @Roles('Freelancer')
  mine(@CurrentUser() user: User) {
    return this.svc.mine(user);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'One active product' })
  bySlug(@Param('slug') slug: string) {
    return this.svc.bySlug(slug);
  }

  @Post()
  @ApiBearerAuth() @UseGuards(...AUTH) @Roles('Freelancer')
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  create(@Body() dto: ProductDto, @CurrentUser() user: User) {
    return this.svc.create(dto, user);
  }

  @Put(':id')
  @ApiBearerAuth() @UseGuards(...AUTH) @Roles('Freelancer')
  update(@Param('id') id: string, @Body() dto: ProductDto, @CurrentUser() user: User) {
    return this.svc.update(id, dto, user);
  }

  @Post(':id/submit') @HttpCode(HttpStatus.OK)
  @ApiBearerAuth() @UseGuards(...AUTH) @Roles('Freelancer')
  submit(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.move(id, 'submit', user);
  }

  @Post(':id/pause') @HttpCode(HttpStatus.OK)
  @ApiBearerAuth() @UseGuards(...AUTH) @Roles('Freelancer')
  pause(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.move(id, 'pause', user);
  }

  @Post(':id/resume') @HttpCode(HttpStatus.OK)
  @ApiBearerAuth() @UseGuards(...AUTH) @Roles('Freelancer')
  resume(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.move(id, 'resume', user);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(...AUTH)
@Roles('Admin')
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly svc: ProductsService) {}

  @Get()
  list(@Query() q: AdminProductsQueryDto) {
    return this.svc.adminList(q.status);
  }

  @Patch(':id/status')
  review(@Param('id') id: string, @Body() dto: ReviewProductDto) {
    return this.svc.review(id, dto.status, dto.note);
  }
}
