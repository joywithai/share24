#!/usr/bin/env node
/**
 * Runs after `npm install` / `npm ci`.
 *
 * `generated/prisma` is git-ignored, so a fresh clone has no client and
 * `next build` cannot resolve `@/generated/prisma/client`. Generating it here
 * means Vercel, CI and Docker only need their ordinary install → build steps.
 *
 * `prisma.config.ts` insists on a DATABASE_URL, so a placeholder is supplied
 * when the environment has none: `generate` only reads the schema and never
 * opens a connection. Migrations and the seed still need the real value, and
 * fail loudly without it.
 *
 * When the Prisma CLI is absent (an install with dev dependencies omitted),
 * this steps aside quietly — such images generate the client in their build
 * stage instead.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const cli = path.join(
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
);

if (!existsSync(cli)) {
  console.log(
    '[postinstall] Prisma CLI not installed — skipping client generation.',
  );
  process.exit(0);
}

const env = {
  ...process.env,
  DATABASE_URL:
    process.env.DATABASE_URL ||
    'postgresql://generate:generate@127.0.0.1:5432/generate',
};

const result = spawnSync(process.execPath, ['scripts/prisma.mjs', 'generate'], {
  stdio: 'inherit',
  env,
});

process.exit(result.status ?? 1);
