import { Controller, Get, HttpCode, Inject, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Pool } from 'pg';
import { DB_POOL } from '../../database/database.module';

const DB_CHECK_TIMEOUT_MS = 2_000;

/**
 * Probes for the load balancer / orchestrator, served outside the /api/v1 prefix.
 *
 * - /livez: the process is up. Never touches dependencies, so a database outage
 *   doesn't get every replica restarted.
 * - /readyz: this replica can serve traffic (database reachable). 503 otherwise, so
 *   the load balancer takes it out of rotation until it recovers.
 */
@ApiTags('health')
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @Get()
  root() {
    return {
      status: 'online',
      name: 'AsteAI Platform API',
      version: '1.0.0',
      message: 'AsteAI REST API is running. Open http://localhost:3000 in your browser for the Web UI.',
      links: {
        webApp: 'http://localhost:3000',
        swaggerDocs: '/api/docs',
        health: '/livez',
      },
    };
  }

  @Get('livez')
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  @Get('readyz')
  @HttpCode(200)
  async ready() {
    const database = await this.checkDatabase();
    if (database !== 'ok') {
      throw new ServiceUnavailableException({ status: 'unavailable', checks: { database } });
    }
    return { status: 'ok', checks: { database } };
  }

  private async checkDatabase(): Promise<string> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), DB_CHECK_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.pool.query('SELECT 1'), timeout]);
      return 'ok';
    } catch (err) {
      return err instanceof Error ? err.message : 'failed';
    } finally {
      clearTimeout(timer);
    }
  }
}
