# Deployment

Everything here is optional for local development — `npm run dev` plus the
embedded database is the whole setup. This is the path to a real deployment.

The app has no build-time dependency on any of it: a deployment with only
`DATABASE_URL` set runs on the local disk, in memory, without a cron job. Add
the pieces below when you need them.

---

## 1. The 20-minute version (Vercel + Neon + R2)

| Piece | Why | Where |
| ----- | --- | ----- |
| **Neon** (or any Postgres) | The database. Serverless Postgres keeps a Vercel deployment honest. | [neon.tech](https://neon.tech) |
| **Cloudflare R2** | Files. Vercel's disk is ephemeral — uploads must not live there. | Cloudflare dashboard → R2 |
| **Vercel** | Hosting, and the cron that runs the cleanup job. | [vercel.com](https://vercel.com) |
| **Upstash Redis** (optional) | Rate-limit counters shared across instances. Without it, limits are per-instance. | [upstash.com](https://upstash.com) |

### Steps

1. **Database.** Create a Neon project, copy the connection string. Run the
   migrations against it:
   ```bash
   DATABASE_URL="postgres://…" node scripts/db.mjs --migrate-only   # if you only want schema
   ```
   In practice the simplest route is to point `DATABASE_URL` at Neon in a local
   `.env` and run `npm run db:dev` once — the script applies every migration,
   including on a fresh database — then start the app normally.

2. **Bucket.** Create the R2 bucket, then an API token with **Object Read &
   Write** on that bucket. Note the account id, the key id and the secret.

3. **Deploy.** Push the repository to GitHub, import it in Vercel. Set the
   environment variables:

   | Variable | Value |
   | -------- | ----- |
   | `DATABASE_URL` | Neon connection string (keep `?sslmode=require`) |
   | `BETTER_AUTH_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `UNLOCK_SECRET` | another random hex string |
   | `NEXT_PUBLIC_APP_URL` | `https://your-domain.com` |
   | `STORAGE_TYPE` | `R2` |
   | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | from step 2 |
   | `CRON_SECRET` | a random string — Vercel sends it with the cron request |
   | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | from Upstash (optional) |

   Do **not** set `CORIUM_UPLOADS_DIR` in production; with `STORAGE_TYPE=R2`
   nothing new is written to the disk.

4. **Cron.** `vercel.json` already schedules hourly cleanup. As long as
   `CRON_SECRET` is set, Vercel authenticates the call itself. Other schedulers
   (cron-job.org, GitHub Actions, a crontab) can do the same:
   ```bash
   curl -fsS -X POST https://your-domain.com/api/cron/cleanup \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

5. **Admin account.** Sign up normally, then make yourself an admin:
   ```sql
   UPDATE "User" SET role = 'admin' WHERE email = 'you@example.com';
   ```
   `/admin` then opens. (Locally, `npm run db:seed` creates
   `admin@sharetofnd.dev / admin123` — never leave that account in production.)

6. **Smoke test** — five things, in this order:
   ```
   /                     → the create buttons
   /create/file          → upload two files, get a link
   /<route>              → the share page, "Download all (.zip)"
   /<route>/download     → the ZIP arrives, names intact
   /admin                → the panel, with a file count
   ```

---

## 2. Self-hosting (Docker, a VPS, a Raspberry Pi)

```bash
git clone <repo> && cd share24
npm install
cp .env.example .env         # fill in DATABASE_URL + the two secrets
npm run db:dev               # or point DATABASE_URL at your own Postgres
npm run build
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
  (or the R2 bucket). They must be restored together — a row without its bytes
  renders the "gone" panel, and bytes without a row are collected by the next
  cleanup run as stray files.

### Docker sketch

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["npm", "run", "start"]
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
