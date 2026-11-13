import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { GeoInfo } from '@asteai/types';
import { JobsQueryDto, PlansQueryDto } from './dto/public.dto';
import { PublicService } from './public.service';

/** Shared caches may keep these for a minute and serve stale while revalidating. */
const EDGE_CACHE = 'public, max-age=60, s-maxage=60, stale-while-revalidate=300';

/** Country from the CDN (CloudFront / Cloudflare) viewer-country header; never derived from the IP here. */
export function countryFrom(headers: Request['headers']): string | null {
  const raw = headers['cloudfront-viewer-country'] ?? headers['cf-ipcountry'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value) && value !== 'XX' ? value : null;
}

@ApiTags('public')
@Controller()
export class PublicController {
  constructor(private readonly svc: PublicService) {}

  @Get('jobs/public')
  @Header('Cache-Control', EDGE_CACHE)
  @Throttle({ short: { ttl: 60_000, limit: 120 } })
  @ApiOperation({ summary: 'Public job board: open, published requisitions (cursor-paginated)' })
  jobs(@Query() q: JobsQueryDto) {
    return this.svc.listJobs({ q: q.q || undefined, locationType: q.locationType, employmentType: q.employmentType }, q.limit ?? 20, q.cursor);
  }

  @Get('jobs/public/:id')
  @Header('Cache-Control', EDGE_CACHE)
  @ApiOperation({ summary: 'One public job; 404 when it is not on the board' })
  job(@Param('id') id: string) {
    return this.svc.getJob(id);
  }

  @Get('plans')
  @Header('Cache-Control', 'public, max-age=300, s-maxage=300')
  @ApiOperation({ summary: 'Pricing plans for the individual or employer audience' })
  plans(@Query() q: PlansQueryDto) {
    return this.svc.plans(q.audience);
  }

  @Get('public-settings/credits')
  @Header('Cache-Control', EDGE_CACHE)
  @ApiOperation({ summary: 'Credit bonuses, proposal tiers and the cost of each AI feature' })
  credits() {
    return this.svc.creditSettings();
  }

  @Get('public/stats')
  @Header('Cache-Control', EDGE_CACHE)
  @ApiOperation({ summary: 'Public marketing counters' })
  stats() {
    return this.svc.stats();
  }

  @Get('geo')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Viewer country from the CDN header (for currency defaults)' })
  geo(@Req() req: Request): GeoInfo {
    return { country: countryFrom(req.headers) };
  }
}
