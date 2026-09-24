#!/usr/bin/env node
/**
 * Prisma CLI wrapper.
 *
 * Prisma 7's Rust-free `prisma-client` generator is pure TypeScript and never
 * executes the native schema-engine binary — but the CLI still *resolves*
 * that binary's path on startup and tries to download it when it is missing.
 * In offline environments that download fails. This wrapper points the CLI at
 * a harmless stub for `generate` (which is all the offline flow needs).
 *
 * On machines with normal network access you can skip this wrapper entirely
 * and run `npx prisma …` directly (the real binary will be downloaded and
 * used for commands that need it, e.g. `migrate dev`).
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const stub =
  process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : '/bin/true';

const env = {
  ...process.env,
  PRISMA_SCHEMA_ENGINE_BINARY: process.env.PRISMA_SCHEMA_ENGINE_BINARY ?? stub,
};

const result = spawnSync('npx', ['prisma', ...args], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
