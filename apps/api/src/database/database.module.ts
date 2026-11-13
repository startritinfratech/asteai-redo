import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Signer } from '@aws-sdk/rds-signer';
import { Pool, PoolClient, PoolConfig } from 'pg';

export const DB_POOL = 'DB_POOL';

const logger = new Logger('DatabaseModule');

/**
 * Password source for the pool. With DATABASE_IAM_AUTH=true (the RDS setup in infra/)
 * every new connection gets a fresh 15-minute IAM auth token instead of a static password.
 */
function passwordFor(config: ConfigService): PoolConfig['password'] {
  if (config.get('DATABASE_IAM_AUTH') !== 'true') {
    return config.getOrThrow<string>('DATABASE_PASSWORD');
  }
  const signer = new Signer({
    hostname: config.getOrThrow<string>('DATABASE_HOST'),
    port: Number(config.get('DATABASE_PORT', 5432)),
    username: config.getOrThrow<string>('DATABASE_USER'),
    region: config.getOrThrow<string>('AWS_REGION'),
  });
  return () => signer.getAuthToken();
}

function sslFor(config: ConfigService): PoolConfig['ssl'] {
  if (config.get('DATABASE_SSL') !== 'true') return undefined;
  // RDS certificates chain to the AWS CA, which is not in Node's default trust store.
  // Set DATABASE_SSL_REJECT_UNAUTHORIZED=true once the AWS CA bundle is installed.
  return { rejectUnauthorized: config.get('DATABASE_SSL_REJECT_UNAUTHORIZED') === 'true' };
}

/**
 * Runs `fn` inside a transaction on one pooled client: COMMIT on success,
 * ROLLBACK (and rethrow) on any error.
 */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

@Injectable()
class PoolShutdown implements OnApplicationShutdown {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
    logger.log('Connection pool closed');
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DB_POOL,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<Pool> => {
        const pool = new Pool({
          host: config.getOrThrow<string>('DATABASE_HOST'),
          port: Number(config.get('DATABASE_PORT', 5432)),
          database: config.getOrThrow<string>('DATABASE_NAME'),
          user: config.getOrThrow<string>('DATABASE_USER'),
          password: passwordFor(config),
          max: Number(config.get('DATABASE_MAX_POOL', 20)),
          idleTimeoutMillis: Number(config.get('DATABASE_IDLE_TIMEOUT_MS', 30_000)),
          connectionTimeoutMillis: Number(config.get('DATABASE_CONNECT_TIMEOUT_MS', 10_000)),
          ssl: sslFor(config),
        });

        pool.on('error', (err) => logger.error(`Unexpected pool error: ${err.message}`));

        try {
          const { rows } = await pool.query<{ version: string }>('SELECT version()');
          logger.log(`Connected: ${rows[0].version.split(' ').slice(0, 2).join(' ')}`);
        } catch (err) {
          logger.error(`DB connection failed: ${err instanceof Error ? err.message : String(err)}`);
          await pool.end().catch(() => undefined);
          throw err;
        }

        return pool;
      },
    },
    PoolShutdown,
  ],
  exports: [DB_POOL],
})
export class DatabaseModule {}
