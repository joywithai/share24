#!/usr/bin/env node
/**
 * Starts the local embedded PostgreSQL used for development
 * (`npm run db:dev`).
 *
 *  - data directory: ./.pg/data (git-ignored, persistent across restarts)
 *  - connection:     postgresql://postgres:postgres@127.0.0.1:5433/corium
 *  - creates the `corium` database on first run
 *  - applies prisma/migrations/*.sql when the schema is not present yet
 *
 * Production uses a managed PostgreSQL (e.g. Neon) — this script is only a
 * local-development convenience so the app can run anywhere, including
 * offline sandboxes.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import EmbeddedPostgres from 'embedded-postgres';

// Honour a DATABASE_URL set in .env (the same file the app itself reads).
config();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const url = new URL(
  process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:5433/corium',
);
const user = url.username || 'postgres';
const password = url.password || 'postgres';
const host = url.hostname || '127.0.0.1';
const port = Number(url.port || 5433);
const dbName = (url.pathname || '/corium').replace(/^\//, '') || 'corium';

const databaseDir = path.join(root, '.pg', 'data');

const pg = new EmbeddedPostgres({
  databaseDir,
  user,
  password,
  port,
  authMethod: 'scram-sha-256',
  persistent: true,
});

const isInitialised = existsSync(path.join(databaseDir, 'PG_VERSION'));

if (!isInitialised) {
  console.log(
    '[db] initialising a new embedded PostgreSQL cluster in ./.pg/data …',
  );
  await pg.initialise();
}

console.log(`[db] starting embedded PostgreSQL on ${host}:${port} …`);
await pg.start();

// Create the application database if it does not exist yet.
{
  const admin = pg.getPgClient('postgres', host);
  await admin.connect();
  const { rows } = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [dbName],
  );
  if (rows.length === 0) {
    await admin.query(`CREATE DATABASE "${dbName}"`);
    console.log(`[db] created database "${dbName}"`);
  }
  await admin.end();
}

// Apply migrations if the schema is not present (V1 ships a single init).
{
  const client = pg.getPgClient(dbName, host);
  await client.connect();
  const { rows } = await client.query(
    "SELECT to_regclass('public.Share') AS share, to_regclass('public.User') AS app_user",
  );
  const hasSchema = Boolean(rows[0]?.share && rows[0]?.app_user);
  if (!hasSchema) {
    const dir = path.join(root, 'prisma', 'migrations');
    // Prisma layout: prisma/migrations/<timestamp_name>/migration.sql
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name, 'migration.sql'))
      .sort();
    for (const file of files) {
      console.log(`[db] applying ${path.basename(path.dirname(file))} …`);
      await client.query(readFileSync(file, 'utf8'));
    }
    console.log('[db] schema applied');
  } else {
    console.log('[db] schema already present — nothing to apply');
  }
  await client.end();
}

console.log(`[db] ready → postgresql://${user}:***@${host}:${port}/${dbName}`);

// Keep the process alive until asked to stop.
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('[db] shutting down …');
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
await new Promise(() => {});
