#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
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
import { hashPassword, verifyPassword } from 'better-auth/crypto';
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

// --- Demo user (demo@sharetofnd.dev / password123) -----------------------
const DEMO_EMAIL = 'demo@sharetofnd.dev';
const DEMO_PASSWORD = 'password123';

const userRes = await client.query(
  'SELECT "id" FROM "User" WHERE "email" = $1',
  [DEMO_EMAIL],
);
let userId = userRes.rows[0]?.id;

/** Insert the Better Auth credential account row for `userId`. */
async function createCredentialAccount(id, at) {
  await client.query(
    `INSERT INTO "Account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
     VALUES ($1, $2, 'credential', $3, $4, $5, $5)`,
    [crypto.randomUUID(), id, id, await hashPassword(DEMO_PASSWORD), at],
  );
}

if (!userId) {
  userId = crypto.randomUUID();
  const ts = iso(now);
  await client.query(
    `INSERT INTO "User" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Demo', $2, true, $3, $3)`,
    [userId, DEMO_EMAIL, ts],
  );
  await createCredentialAccount(userId, ts);
  console.log(`[seed] created demo user ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
} else {
  // Better Auth verifies account passwords with its own scrypt hash
  // (`better-auth/crypto`) — not bcrypt — and it only recognises a credential
  // account whose `accountId` equals the user id (see
  // `better-auth/dist/api/routes/sign-in.mjs`). Repair either problem so
  // re-seeding an existing database still leaves a working login.
  const accountRes = await client.query(
    `SELECT "id", "accountId", "password" FROM "Account"
      WHERE "userId" = $1 AND "providerId" = 'credential'
      ORDER BY "createdAt" LIMIT 1`,
    [userId],
  );
  const account = accountRes.rows[0];
  const verifies = account?.password
    ? await verifyPassword({
        hash: account.password,
        password: DEMO_PASSWORD,
      }).catch(() => false)
    : false;

  if (!account) {
    await createCredentialAccount(userId, iso(now));
    console.log(
      `[seed] created the missing credential account for ${DEMO_EMAIL}`,
    );
  } else if (verifies && account.accountId === userId) {
    console.log('[seed] demo user already exists — skipping');
  } else {
    await client.query(
      `UPDATE "Account"
          SET "password" = $1, "accountId" = $2, "updatedAt" = $3
        WHERE "id" = $4`,
      [await hashPassword(DEMO_PASSWORD), userId, iso(now), account.id],
    );
    console.log(
      `[seed] repaired the demo user's credential account (${DEMO_EMAIL} / ${DEMO_PASSWORD})`,
    );
  }
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
      '// shared via sharetofnd — this text vanishes in 24 hours\n\nfunction greet(name) {\n  return "hello, " + name + "!";\n}\n\nconsole.log(greet("world"));\n',
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
  const content = 'Sharetofnd demo file. Download it before it burns.\n';
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
