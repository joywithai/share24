#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import bcrypt from 'bcryptjs';
/**
 * Development seed: a demo user plus sample shares (one active code share,
 * one active file share, one expired share) so the profile page and the
 * expiry states have something to show.
 *
 *   npm run db:seed        (uses DATABASE_URL from the environment / .env)
 *
 * Uses plain SQL on purpose — the generated Prisma client is bundler-only,
 * and a seed script should run with a bare `node`.
 */
import { config } from 'dotenv';
import pg from 'pg';

config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[seed] DATABASE_URL is not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();

const now = new Date();
const day = 24 * 60 * 60 * 1000;
const iso = (d) => d.toISOString();

// --- Demo user (demo@corium.dev / password123) ----------------------------
const userRes = await client.query(
  'SELECT "id" FROM "User" WHERE "email" = $1',
  ['demo@corium.dev'],
);
let userId = userRes.rows[0]?.id;

if (!userId) {
  userId = crypto.randomUUID();
  // better-auth's credential account: bcrypt hash of the password
  const passwordHash = bcrypt.hashSync('password123', 10);
  const ts = iso(now);
  await client.query(
    `INSERT INTO "User" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Demo', 'demo@corium.dev', true, $2, $2)`,
    [userId, ts],
  );
  await client.query(
    `INSERT INTO "Account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
     VALUES ($1, 'demo-account', 'credential', $2, $3, $4, $4)`,
    [crypto.randomUUID(), userId, passwordHash, ts],
  );
  console.log('[seed] created demo user demo@corium.dev / password123');
} else {
  console.log('[seed] demo user already exists — skipping');
}

// --- Sample active code share ---------------------------------------------
const codeTaken = await client.query(
  `SELECT 1 FROM "Share" WHERE "route" = 'hello-world' AND "isExpired" = false AND "expiresAt" > $1`,
  [iso(now)],
);
if (codeTaken.rows.length === 0) {
  await client.query(
    `INSERT INTO "Share" ("id", "type", "route", "content", "expiresAt", "userId", "createdAt")
     VALUES ($1, 'code', 'hello-world', $2, $3, $4, $5)`,
    [
      crypto.randomUUID(),
      '// shared via corium — this text vanishes in 24 hours\n\nfunction greet(name) {\n  return "hello, " + name + "!";\n}\n\nconsole.log(greet("world"));\n',
      iso(new Date(now.getTime() + day)),
      userId,
      iso(now),
    ],
  );
  console.log('[seed] created sample code share /hello-world');
}

// --- Sample active file share ---------------------------------------------
const fileTaken = await client.query(
  `SELECT 1 FROM "Share" WHERE "route" = 'hello-file' AND "isExpired" = false AND "expiresAt" > $1`,
  [iso(now)],
);
if (fileTaken.rows.length === 0) {
  const shareId = crypto.randomUUID();
  const uploads =
    process.env.CORIUM_UPLOADS_DIR ?? path.join('/tmp', 'corium-uploads');
  const dir = path.join(uploads, shareId);
  mkdirSync(dir, { recursive: true });
  const storedName = `${shareId}.txt`;
  const content = 'Corium demo file. Download it before it burns.\n';
  writeFileSync(path.join(dir, storedName), content);

  await client.query(
    `INSERT INTO "Share" ("id", "type", "route", "fileUrl", "expiresAt", "userId", "createdAt")
     VALUES ($1, 'file', 'hello-file', $2, $3, $4, $5)`,
    [
      shareId,
      `${shareId}/${storedName}`,
      iso(new Date(now.getTime() + day)),
      userId,
      iso(now),
    ],
  );
  await client.query(
    `INSERT INTO "File" ("id", "shareId", "fileName", "fileSize", "mimeType")
     VALUES ($1, $2, 'hello.txt', $3, 'text/plain')`,
    [crypto.randomUUID(), shareId, Buffer.byteLength(content)],
  );
  console.log('[seed] created sample file share /hello-file');
}

// --- Sample expired share ---------------------------------------------------
const expired = await client.query('SELECT 1 FROM "Share" WHERE "route" = $1', [
  'yesterday',
]);
if (expired.rows.length === 0) {
  await client.query(
    `INSERT INTO "Share" ("id", "type", "route", "content", "expiresAt", "isExpired", "userId", "createdAt")
     VALUES ($1, 'code', 'yesterday', 'this one is already gone\n', $2, true, $3, $4)`,
    [
      crypto.randomUUID(),
      iso(new Date(now.getTime() - 3600_000)),
      userId,
      iso(now),
    ],
  );
  console.log('[seed] created expired sample share /yesterday');
}

await client.end();
console.log('[seed] done');
