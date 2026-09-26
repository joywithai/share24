# Deployment

Everything here is optional for local development — `npm run dev` plus the
embedded database is the whole setup. This is the path to a real deployment.

The app has no build-time dependency on any of it: a deployment with only
`DATABASE_URL` set runs on the local disk, in memory, without a cron job. Add
the pieces below when you need them.

---

## 1. The 20-minute version (Vercel + Supabase + R2)

| Piece | Why | Where |
| ----- | --- | ----- |
| **Supabase** (or any Postgres) | The database. | [supabase.com](https://supabase.com) |
| **Backblaze B2** (or Cloudflare R2) | Files. Vercel's disk is ephemeral — uploads must not live there. | [backblaze.com](https://www.backblaze.com/cloud-storage) / Cloudflare dashboard → R2 |
| **Vercel** | Hosting, and the cron that runs the cleanup job. | [vercel.com](https://vercel.com) |
| **Upstash Redis** (optional) | Rate-limit counters shared across instances. Without it, limits are per-instance. | [upstash.com](https://upstash.com) |

### Steps

1. **Database.** Create a Supabase project (region nearest your users; keep the
   database password). Then open **Connect** in the dashboard and copy *two*
   connection strings out of it:

   | Which | Where it points | Used for |
   | ----- | --------------- | -------- |
   | **Transaction pooler** | `aws-0-<region>.pooler.supabase.com:6543`, user `postgres.<project-ref>` | `DATABASE_URL` in production — serverless-friendly and IPv4 |
   | **Session pooler** | the same pooler host, port `5432` | migrations, which need a real session |

   **Append `?sslmode=require` to both.** Supabase refuses unencrypted
   connections, and node-postgres (the driver under Prisma here) only turns TLS
   on when the URL asks for it — without the parameter you get
   `no pg_hba.conf entry … SSL off`.

   > The **direct** connection (`db.<project-ref>.supabase.co:5432`) is IPv6-only
   > on newer Supabase projects, and plenty of networks still have no IPv6. The
   > pooler is the IPv4 way in, which is why both strings above come from it.

2. **Schema.** Apply the migrations once, to the empty project, with the
   **session** string:
   ```bash
   DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require" \
     npx prisma migrate deploy
   ```
   One runner per database: this applies the SQL in `prisma/migrations/` and
   records it in Prisma's own `_prisma_migrations` table. The local
   `npm run db:dev` keeps a separate ledger (`_migrations`) and re-applies
   anything missing from it, so do not point it at a database you migrated
   this way.

3. **Bucket.** Either provider works; both are spoken over the S3 API.

   *Backblaze B2:* create a bucket (note its **region**, e.g. `us-east-005`),
   then an application key with read/write access to it. You need the key id,
   the application key, the endpoint (`s3.<region>.backblazeb2.com`), the
   bucket name and that same region — B2 signs per region, so a mismatch is an
   auth error rather than a 404.

   *Cloudflare R2:* create the bucket, then an API token with **Object Read &
   Write** on it. Note the account id, the key id and the secret.

4. **Deploy.** Push the repository to GitHub, import it in Vercel. Set the
   environment variables:

   | Variable | Value |
   | -------- | ----- |
   | `DATABASE_URL` | the Supabase **transaction pooler** URI, with `?sslmode=require` |
   | `DIRECT_URL` | the Supabase **session pooler** URI (port 5432, `?sslmode=require`) — used by `npm run db:deploy` so migrations get a real session |
   | `BETTER_AUTH_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `UNLOCK_SECRET` | another random hex string |
   | `NEXT_PUBLIC_APP_URL` | `https://your-domain.com` |
   | `STORAGE_TYPE` | `B2` (or `R2`) |
   | `B2_ENDPOINT`, `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME`, `B2_REGION` | from step 3, for B2 |
   | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | from step 3, for R2 |
   | `CRON_SECRET` | a random string — Vercel sends it with the cron request |
   | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | from Upstash (optional) |

   Do **not** set `CORIUM_UPLOADS_DIR` in production; with a bucket selected
   nothing new is written to the disk. Set these **before the first deploy**:
   the build imports the Prisma client while collecting page data, so a build
   without `DATABASE_URL` fails with `DATABASE_URL is not set`.

5. **Cron.** `vercel.json` already schedules hourly cleanup. As long as
   `CRON_SECRET` is set, Vercel authenticates the call itself. Other schedulers
   (cron-job.org, GitHub Actions, a crontab) can do the same:
   ```bash
   curl -fsS -X POST https://your-domain.com/api/cron/cleanup \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

6. **Admin account.** Sign up normally, then make yourself an admin:
   ```sql
   UPDATE "User" SET role = 'admin' WHERE email = 'you@example.com';
   ```
   `/admin` then opens. (Locally, `npm run db:seed` creates
   `admin@sharetofnd.dev / admin123` — never leave that account in production.)

7. **Smoke test** — five things, in this order:
   ```
   /                     → the create buttons
   /create/file          → upload two files, get a link
   /<route>              → the share page, "Download all (.zip)"
   /<route>/download     → the ZIP arrives, names intact
   /admin                → the panel, with a file count
   ```

### Supabase notes

- **Backups.** Supabase takes daily backups on paid plans; on the free plan take
  your own (`pg_dump "<session uri>" > backup.sql`) — and remember the file
  bytes have to travel with them (§3).
- **Free projects pause** after about a week with no activity. A paused project
  refuses connections until you resume it in the dashboard; the app errors
  until then and nothing is lost.
- **Connection pooling** is the reason for the two strings above. Supavisor's
  transaction mode shares a handful of Postgres connections between all your
  functions. This app's Prisma client talks to Postgres through node-postgres
  with unnamed prepared statements, which the transaction pooler supports as
  is; a tool that uses Prisma's classic query engine instead would need
  `?pgbouncer=true` appended.
- **Row-level security** guards Supabase's REST/anon-key API, not this app: the
  app connects as the `postgres` role over plain Postgres, and never carries an
  anon key. If you publish that project's anon key somewhere else, enable RLS
  with no policies on the app's tables — the owner role the app uses is not
  restricted by it.

---

## 2. Self-hosting (Docker, a VPS, a Raspberry Pi)

```bash
git clone <repo> && cd share24
npm install                  # postinstall generates the Prisma client
cp .env.example .env         # fill in DATABASE_URL + the two secrets (+ DIRECT_URL on Supabase, bucket keys if you use one)
npm run db:dev               # or point DATABASE_URL at your own Postgres
npm run build                # needs DATABASE_URL in the environment
npm run start                # listens on 0.0.0.0:3000
```

- **Files** live in `CORIUM_UPLOADS_DIR` (default `./.uploads` in a dev setup,
  `/tmp/corium-uploads` otherwise). Point it at a real volume, and check
  `cp -r .uploads /backup/` restores along with the database dump.
- **TLS** belongs in front of the app: Caddy, nginx or a Cloudflare tunnel. Two
  things to configure there:
  1. **Forward the client address** (`X-Forwarded-For`) — rate limiting and the
     security log key off it. Without a header, every request counts as
     `unknown` and shares one bucket.
  2. **Framing.** The app deliberately sends no `frame-ancestors` /
     `X-Frame-Options`, because it is designed to run inside a preview iframe.
     If you serve it top-level, add `Content-Security-Policy:
     frame-ancestors 'none'` at the proxy.
- **Backups**: `pg_dump` for the database plus a copy of `CORIUM_UPLOADS_DIR`
  (or the B2/R2 bucket). They must be restored together — a row without its bytes
  renders the "gone" panel, and bytes without a row are collected by the next
  cleanup run as stray files.

### Docker sketch

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
# The source (and scripts/postinstall.mjs) is not in the image yet, so install
# dependencies without hooks and generate the client after COPY.
RUN npm ci --ignore-scripts
COPY . .
# `next build` imports the Prisma client while collecting page data, so the
# connection string must exist at build time — it is not used to connect.
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL
RUN npm run db:generate && npm run build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["npm", "run", "start"]
```

```bash
docker build --build-arg DATABASE_URL="$DATABASE_URL" -t share24 .
docker run -p 3000:3000 --env-file .env -v "$PWD/.uploads:/app/.uploads" share24
```

Mount two volumes: `/app/.uploads` (or leave it out with `STORAGE_TYPE=R2`) and
the database's data directory if you run Postgres alongside.

---

## 3. Operating it

### Maintenance mode

Admin → Settings → **Maintenance mode**: visitors cannot create shares and
downloads answer `503` with an explanation; the panel, and therefore the switch,
keeps working. The banner above the header tells visitors why.

### The cleanup job

Admin → Storage → **Run cleanup now**, or the cron endpoint. It removes:

| What | When |
| ---- | ---- |
| Expired shares (rows + bytes) | After `expired_share_retention_hours` (default 24) |
| Rows whose bytes are gone | Same window, only for expired shares |
| Files no share claims | Older than the retention window |
| Empty share folders | Immediately, when unclaimed |
| Expired IP blocks | Immediately |
| Security events | Older than 30 days |

`cleanup_enabled = off` pauses the *scheduled* run (a manual run still works).

### Rate limits

| What | Limit | Counted per |
| ---- | ----- | ----------- |
| Creating a code share | 10 per hour | address |
| Uploading files | 20 per hour | address |
| PIN attempts | 5 per minute | address **and** share |
| Downloads | 30 per hour | address |
| Sign-in attempts | 5 per 15 minutes | address |

Three violations from one address earn a 15-minute block, on top of the limit.
The numbers are constants in `lib/security/rate-limit.ts` — raise `create`,
`upload`, `download` or `login` there if your audience is behind one NAT and
they complain (a busy office looks like one address).

Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` so every instance
counts on the same counters; without them each process counts alone, which is
correct for a single server. A configured-but-unreachable Redis falls back to
memory after 1.5 s instead of failing the request.

### Health checks

- `/admin/storage` — provider readiness, and a consistency scan that answers
  "is the database still describing real files?" from both directions.
- `/admin/security` — event counts for the last 24 hours, active rate limits,
  and the block list.
- `/api/cron/cleanup` with the bearer token returns a JSON report; a scheduler
  can alert on `errors.length > 0`.

### Rate limiting without Redis

In-memory limits are correct for a single instance, and are what a self-hosted
deployment wants. On serverless, instances do not share memory — set the Upstash
variables, or limits become "per lambda" (still a limit, but a much weaker one).
If Redis is configured and then becomes unreachable, the limiter falls back to
memory rather than failing requests.

---

## 4. Known V1 limits

- **No virus scanning.** Uploads are validated by extension, MIME type and the
  first 8 KB of content, but the bytes are never scanned. A deployment that
  accepts files from the public internet should add ClamAV (or a scanning API)
  in front of the storage provider.
- **No e-mail.** Password reset and e-mail verification need an SMTP provider;
  Better Auth supports both, the app just does not wire them up yet.
- **2FA is not enabled.** Better Auth ships a `twoFactor` plugin; enabling it
  means a `twoFactor` table, an enrolment screen and a second step on sign-in,
  which is a V2 feature rather than a checkbox.
- **Password policy** is Better Auth's default (8 characters). Add
  `emailAndPassword.minPasswordLength` in `lib/auth.ts` if you need more.
- **Uploads are capped** at 10 files per share, 10 MB each, 50 MB per share,
  and archives/executables/web pages/video/audio are refused by design.
