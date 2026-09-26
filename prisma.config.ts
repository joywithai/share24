import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 dropped `url`/`directUrl` from the schema, so the connection
 * strings live here.
 *
 * **`DIRECT_URL` wins for CLI commands.** On Supabase the app talks through
 * the transaction pooler (port 6543, `?pgbouncer=true`), which is right for
 * serverless requests but wrong for migrations: they need a real session. This
 * is the Prisma 7 equivalent of the schema-level `directUrl` — set both
 * variables and `npx prisma migrate deploy` (or `npm run db:deploy`) runs
 * against the session pooler while the running app keeps using the pooler URL.
 *
 *     DATABASE_URL  postgresql://…pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require
 *     DIRECT_URL    postgresql://…pooler.supabase.com:5432/postgres?sslmode=require
 *
 * Locally there is no `DIRECT_URL`, so both roles are the embedded database.
 * `sslmode=require` matters: node-postgres — the driver under the Prisma
 * adapter — only starts TLS when the URL asks for it, and Supabase refuses
 * unencrypted connections.
 */
const directUrl = process.env.DIRECT_URL?.trim();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node scripts/seed.mjs',
  },
  datasource: {
    url: directUrl || env('DATABASE_URL'),
  },
});
