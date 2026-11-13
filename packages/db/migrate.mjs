#!/usr/bin/env node
/**
 * Applies packages/db/migrations/*.sql in filename order, once each, recording them in
 * schema_migrations. Each file runs in its own transaction.
 *
 *   DATABASE_URL=postgres://... bun run --filter @asteai/db migrate
 *   bun run --filter @asteai/db migrate -- --status     # list applied / pending
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const statusOnly = process.argv.includes('--status');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const { rows } = await client.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) {
      if (statusOnly) console.log(`applied  ${file}`);
      continue;
    }
    if (statusOnly) {
      console.log(`pending  ${file}`);
      continue;
    }
    const sql = await readFile(join(dir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`applied  ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`failed   ${file}: ${err.message}`);
      process.exitCode = 1;
      break;
    }
  }
} finally {
  await client.end();
}
