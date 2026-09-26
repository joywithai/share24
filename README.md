# Sharetofnd (share24)

Temporary sharing for developers — somewhere between Pastebin and WeTransfer,
but minimal. Give it a route, get a link. Everything self-destructs after
**24 hours**. No account required (optional login just collects your shares on
one page).

> **What changed, round by round:** see [`CHANGELOG.md`](./CHANGELOG.md).

```
something to share → no signup, no forms → paste it + pick a route → link
→ the share dies in 24h (soft-deleted, lazy check, no cron)
```

## V1 features

- **Code sharing** — Monaco editor (bundled, no CDN), plain text, 200 KB cap
- **File sharing** — drag & drop 1–10 files under one route (10 MB each, 50 MB
  per share) except archives, executables, active web content and video/audio
  (block-list, not allow-list); viewers download them one by one or all
  together as a streamed ZIP
- **Custom routes** — `/{a-z0-9_-}` 3–50 chars; reserved words blocked; a route
  is free again as soon as the previous share expires
- **Open by name** — type (or paste) a share name in the homepage box to jump
  straight to that link; unknown names land on the 404 page with a Back button.
  The two create actions sit directly under that box, and the how-it-works
  steps follow below them
- **Your slugs** — creating a share drops you back on the homepage, which
  lists the names *this browser* made as chips (newest first, arrows once the
  strip overflows); one click copies the link. Kept in `sessionStorage` only —
  gone when the tab closes, and each entry expires with its share after 24 h.
  No database involved, and nothing is sent anywhere
- **Optional 4-digit PIN** — bcrypt-hashed; unlocking mints a short-lived,
  HMAC-signed cookie for that route (creator auto-unlocks on creation)
- **Downloads that explain themselves** — the file *name* in a list is a
  download link too (not just the buttons); before answering, the download
  routes check the bytes are still on disk, so a folder wipe cannot hand out a
  0-byte archive. Whatever is left is what a ZIP contains, and a failure
  renders a small page with the reason and two ways out (share again / go
  home) instead of a bare sentence. Inside an embedded preview the page also
  says how to get the file out when the surrounding sandbox swallows the
  click
- **24-hour expiry** — lazy evaluation on access; `isExpired` flag flipped
  opportunistically (no cron)
- **Anonymous or signed in** — Better Auth (email + password); `/profile`
  lists your shares with live status
- **Dark, minimal UI** — fixed palette, 1000px centered layout

## Production features

Everything below was added on top of that visitor flow, which is unchanged — no
extra step, no account, no cookie banner.

**Security**
- Rate limits per address on every write and every guess (create, PIN, download,
  lookup, auth), in memory or shared through Upstash Redis when configured
- Automatic blocking: three limit violations from one address earn a 15-minute
  block; repeat offenders are visible in the panel and can be blocked by hand
- Uploads are checked three ways — extension, declared MIME type, and the first
  8 KB of actual content — so a ZIP renamed to `.png` is refused; file names are
  sanitised before they are stored or echoed back
- `Content-Security-Policy` and friends on every response, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`, no `X-Powered-By`
- Every refusal is a page that explains itself, and every security-relevant
  event is recorded (`SecurityEvent`)

**Operations**
- `/admin` panel: dashboard with 14-day charts, shares, files, users, security
  log, storage, audit log, settings, and one global search across all of it
- Global search (`/admin/search`) matches routes, file names, accounts and the
  security log in one query
- Background cleanup (`/api/cron/cleanup`, hourly on Vercel, or a button in the
  panel): expired shares past the retention window, orphaned rows, unclaimed
  files, empty folders, expired blocks, old events — bounded and idempotent
- Maintenance mode that visitors see and administrators can still work through
- Storage that can leave the disk: LOCAL or Cloudflare R2, per file
- Configurable retention and cleanup switches in a typed settings registry

**Deployment** — see [`DEPLOYMENT.md`](./DEPLOYMENT.md).

### Deliberately not in V1

editing a share after creation, permanent links, teams, light mode, more than 10
files per share, virus scanning, e-mail (reset/verification), 2FA, and a ZIP
larger than 4 GB (no ZIP64).

## Tech stack

| Concern            | Choice                                                        |
| ------------------ | ------------------------------------------------------------- |
| Framework          | Next.js 15 (App Router, React 19) — Server Components by default, `'use client'` only where interactive |
| Mutations          | Server Actions (with server-side re-validation)               |
| Forms/validation   | React Hook Form + Zod (one schema, validated client AND server) |
| Database           | PostgreSQL via **Prisma 7** (Rust-free `prisma-client` generator) + `@prisma/adapter-pg` driver adapter |
| Local dev database | embedded PostgreSQL (`embedded-postgres` npm package) — `npm run db:dev` |
| Auth               | Better Auth (email + password, Prisma adapter)                |
| Editor             | `monaco-editor`, bundled with web workers, loaded via `dynamic(ssr: false)` |
| Styling            | Tailwind CSS v4 (CSS-first `@theme` tokens) + hand-rolled shadcn-style `components/ui/*` |
| Lint/format        | Biome                                                         |
| Tests              | Vitest (unit + component), Playwright (e2e, 3 critical flows) |

## Quick start (local)

```bash
npm install

# 0. Create your .env (then put a real random value in BETTER_AUTH_SECRET:
#    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
cp .env.example .env

# 1. Start the embedded PostgreSQL (data lives in ./.pg, port 5433)
npm run db:dev            # leave running in another terminal

# 2. The Prisma client was already generated by `npm install` (postinstall).
#    Re-run it any time with the offline-safe wrapper:
npm run db:generate

# 3. (Optional) seed a demo user + sample shares
npm run db:seed           # demo@sharetofnd.dev / password123

# 4. Run the app
npm run dev               # http://localhost:3000
```

Copy `.env.example` to `.env` (step 0 above) — the defaults already point at the
embedded database, so only `BETTER_AUTH_SECRET` needs a real value. (The build
imports the Prisma client while collecting page data, so `DATABASE_URL` has to
be set wherever `npm run build` runs, not just at runtime.) If you
prefer your own Postgres — Supabase in production — just set `DATABASE_URL` and
apply the schema with `npx prisma migrate deploy` (the migration SQL lives in
`prisma/migrations/`). Supabase needs the pooler URI plus `?sslmode=require`;
[`DEPLOYMENT.md`](./DEPLOYMENT.md) has the exact strings.

> **Why `npm run db:generate` instead of `npx prisma generate`?**
> Prisma 7's CLI still *resolves* the native schema-engine binary on startup
> and downloads it when missing. In offline environments that download fails
> even though the Rust-free generator never runs it. `scripts/prisma.mjs`
> points the CLI at a harmless stub for `generate`. On machines with normal
> network access, plain `npx prisma …` works fine (the real binary is used
> for commands that need it, e.g. `migrate dev`).

### Scripts

| Script                | What it does                                              |
| --------------------- | --------------------------------------------------------- |
| `npm run dev`         | Dev server on `0.0.0.0:3000`                              |
| `npm run build` / `start` | Production build / serve                            |
| `npm run db:dev`      | Start embedded PostgreSQL + apply migrations (dev)        |
| `npm run db:generate` | Generate the Prisma client (offline-safe wrapper; `npm install` runs it for you) |
| `npm run postinstall` | Runs after installs — generates the client so a fresh clone can build |
| `npm run db:seed`     | Demo user + sample shares (active code, active file, expired) |
| `npm test`            | Vitest: unit + component + server-action tests (258)      |
| `npm run e2e`         | Playwright: the 3 critical flows (needs `npx playwright install chromium`) |
| `npm run lint`        | Biome check                                               |

## Environment variables

| Variable             | Required | Notes |
| -------------------- | -------- | ----- |
| `DATABASE_URL`       | yes      | PostgreSQL connection string (embedded dev default in `.env.example`; on Supabase, the transaction pooler URI + `?sslmode=require`) |
| `BETTER_AUTH_SECRET` | yes      | Random 32+ byte hex — session cookies, unlock-token HMAC |
| `NEXT_PUBLIC_APP_URL`| prod     | Public URL; Better Auth cookie scoping. Leave empty locally |
| `CORIUM_UPLOADS_DIR` | no       | Upload storage root for `LOCAL`, default `/tmp/corium-uploads` (dev bootstrap uses `./.uploads`) |
| `STORAGE_TYPE`       | no       | Where **new** uploads go: `LOCAL` (default) or `R2`. Existing shares keep their own storage |
| `R2_ACCOUNT_ID`      | R2       | Cloudflare account id — the endpoint becomes `https://<id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID`   | R2       | R2 API token (Object Read & Write on the bucket) |
| `R2_SECRET_ACCESS_KEY` | R2     | The token's secret |
| `R2_BUCKET_NAME`     | R2       | Bucket that holds the uploaded objects |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | no | Shared rate-limit counters (Upstash Redis). Unset = per-process |
| `CRON_SECRET`        | prod     | Bearer token for `/api/cron/cleanup`. Unset = admins only |
| `UNLOCK_SECRET`      | no       | Separate HMAC secret for PIN unlock cookies; falls back to `BETTER_AUTH_SECRET` |
| `CORIUM_ALLOWED_ORIGINS` | no   | Comma-separated public origins allowed to post Server Actions when a reverse proxy rewrites `Host` (wildcards ok, e.g. `*.example.app`) |
| `CORIUM_TRUSTED_ORIGINS` | no   | Comma-separated extra origins accepted by Better Auth's CSRF check |

> **Behind a TLS-terminating proxy (preview tunnels, Vercel, nginx):** the proxy
> forwards plain `http://` to the app while browsers send `Origin: https://…`.
> With `NEXT_PUBLIC_APP_URL` unset, `lib/auth.ts` trusts both schemes of the
> host the request arrived on, so sign-in works on any host. Set
> `NEXT_PUBLIC_APP_URL` in production for a fixed origin, and use the two
> `CORIUM_*_ORIGINS` knobs only if your proxy also rewrites `Host`.

## Architecture

### Rendering strategy

```
/               Server Component — name box, create actions, "Your slugs"
                (client-only strip fed by sessionStorage)
/create/code    Client Component — Monaco, RHF state
/create/file    Client Component — drag & drop, RHF state
/[route]        Server Component — DB checks → 404 | expired | PIN form | content
/[route]/download          Route Handler — whole share: the file itself, or a ZIP
/[route]/download/<fileId> Route Handler — one file of the share (PIN-gated)
/login          Server (session check) + client form (Better Auth REST)
/profile        Server Component (middleware-protected)
/api/auth/*     Better Auth REST endpoints
middleware.ts   /profile only; nodejs runtime so it can read the session
```

### Data flow

```
user types → RHF state → Zod (client pass) → Server Action
→ Zod again (mandatory server pass) → route availability check (in a
transaction, so two simultaneous creates on one route can't both win)
→ bcrypt hash if PIN → insert (expiresAt = now + 24h) → remember the slug
  (sessionStorage) → redirect to the homepage, where "Your slugs" shows it
→ viewer: server fetches share → expired? flag check + timestamp check
→ PIN? unlock cookie (HMAC) → content
```

### Database (Prisma)

`User`, `Session`, `Account`, `Verification` (Better Auth standard schema) plus:

```
Share:     id, type(code|file), route, content?, pinHash?,
           expiresAt, isExpired, userId?, createdAt
ShareFile: id, shareId, storedPath, fileName, fileSize, mimeType, position
```

A `file` share owns 1–10 `ShareFile` rows; `position` keeps the order the
author picked them in, which is also the order inside the ZIP.

Route uniqueness is enforced by query (`route` + `isExpired = false` +
`expiresAt > now`) inside the create transaction — expired shares release
their routes automatically.

### Expiry (no cron)

On every access the page checks **both** `isExpired` and `expiresAt <= now`.
If the timestamp has passed, the flag is flipped in the same request and the
expired panel renders — expiry never depends on a scheduled job.

Deleting the *files* behind expired shares is the separate housekeeping job
below; until it runs the bytes simply sit there, unreachable.

### File storage (providers)

Every read and write goes through `StorageProvider` (`lib/storage/`): the local
disk (`LocalStorageProvider`, the V1 default) or a Cloudflare R2 bucket
(`R2StorageProvider`). Both name objects the same way —
`<shareId>/<n>-<sanitized name>`, the share id a server-side random UUID, the
file name stripped of path separators and unusual characters, never taken from
user input as-is — and downloads are streamed by the app, so the bucket never
has to be public and no CDN is involved.

Which provider serves a file is decided **per row** (`ShareFile.storageType`),
which is what makes the switch safe: set `STORAGE_TYPE=R2` and new uploads go to
the bucket while every share already on the disk keeps downloading. Without R2
credentials the app only ever touches the disk.

The old local helpers — `<uploads root>/<shareId>/<n>-<name>` and the
traversal-safe path re-resolution — are unchanged inside `LocalStorageProvider`.

`/<route>/download` serves a single file as itself, or bundles the whole set
into one ZIP (built with `node:zlib` — see `lib/zip.ts` — and streamed as it is
compressed). `/<route>/download/<fileId>` serves one file of the set, and only
when that file belongs to the share in the URL.

Because uploads can outlive — or predecease — their rows, the routes check the
disk before answering: only files whose bytes exist go into a ZIP, the share
page marks the ones that are gone ("Gone", no dead button, a panel when nothing
is left), and every failure renders a small self-contained page with the reason
and two ways out (`lib/download-error.ts`). The file *name* in a list is a
download link as well as the buttons.

## Admin panel (`/admin`)

There is exactly one gated area outside the visitor flow. `User.role`
(`user`/`admin`) and `User.status` (`active`/`suspended`) decide who gets in;
the seed creates `admin@sharetofnd.dev / admin123` (change it, or delete the
account after creating your own). The middleware only checks "is somebody signed
in?"; the layout and every action check the role against the database, and a
signed-in non-admin gets a 404.

| Page       | What it is for |
| ---------- | -------------- |
| Dashboard  | Counts, 14-day charts, the latest shares, maintenance status |
| Shares     | Filter/search, expire a link now, delete it (bytes included) |
| Files      | Per-file "are the bytes still there?" check, storage filter, delete |
| Users      | Promote/demote, suspend (closes their sessions) |
| Security   | Event log with filters, block/unblock an address, active rate limits |
| Storage    | Provider breakdown, R2 readiness, consistency scan, run cleanup |
| Logs       | `AdminLog`: who changed what, plus cleanup runs |
| Settings   | The registry in `lib/settings.ts` — maintenance mode, retention, cleanup switch |

Every panel action writes an `AdminLog` row. Settings are only writable through
the declared registry, so an unknown key can never enter the database.

### Background cleanup

`/api/cron/cleanup` (hourly via `vercel.json`) removes expired shares past the
retention setting, orphaned rows, unclaimed files, empty folders, expired IP
blocks and old security events. It is idempotent and bounded, and an
administrator can trigger it from the Storage page. The same endpoint is how a
cron service other than Vercel drives it: send the `CRON_SECRET` as a bearer
token.

## Security notes

- Routes: `/^[a-z0-9_-]{3,50}$/` + reserved list (`api`, `auth`, `login`,
  `register`, `create`, `profile`, `favicon`, `robots`, `sitemap`, `_next`, …)
- PINs stored bcrypt-only; unlock cookies are HMAC-SHA256 signed, per-route,
  ≤ 1 h, httpOnly, SameSite=Lax
- Download links on an unlocked page carry a short-lived HMAC token (`?k=`,
  scoped to that route and to either the whole share or one file) so a download
  still works when the unlock cookie is missing — stripped by a proxy, refused
  as a third-party cookie, or invalidated by a rotated secret. If neither is
  valid the visitor is sent back to the PIN form with `?download=<scope>`, and
  the download resumes by itself once the PIN is accepted
- Download failures are pages, never a leak: expired `410`, a file id from
  another share `404`, inconsistent metadata `500`, all rendered from a
  self-contained template with the route HTML-escaped
- Server-side re-validation of everything (schemas, file type/size, routes)
- Files: extension allow-list + declared-MIME cross-check (deep magic-byte
  block-list rejects archives/executables/web pages/media), 10 MB per file,
  10 files and 50 MB per share
- ZIP entry names are sanitized and de-duplicated, so a crafted upload name
  cannot escape the archive's own directory or overwrite a sibling entry
- Code is rendered in a read-only Monaco instance (never `dangerouslySetInnerHTML`)
- SQL through Prisma only (parameterized); no raw SQL except dev scripts
- V1 has **no rate limiting** on PIN attempts (documented gap, V2)

## Testing

```bash
npm test                    # 258 tests: route/pin/file/expire/schema rules,
                            # the ZIP writer and download availability,
                            # download failure pages, auth + create flows,
                            # server actions (mocked DB, real file I/O),
                            # rate limits + IP blocking + upload sniffing,
                            # admin guards, settings coercion, cleanup,
                            # global search, UI components (jsdom)
npm run e2e                 # Playwright: code round-trip, file download,
                            # PIN wrong→correct
```

Playwright needs a browser (`npx playwright install chromium`) and a running
app + database. It is not run in CI-less offline sandboxes.

## Deployment

Full walkthrough — Vercel + Supabase + R2, Docker/self-hosting, the environment
variables, the cron endpoint, backups and the V1 limits — lives in
[`DEPLOYMENT.md`](./DEPLOYMENT.md). The short version: `DATABASE_URL`,
`BETTER_AUTH_SECRET` and `UNLOCK_SECRET` are required, `STORAGE_TYPE=R2` plus
the four R2 values is what makes it production-safe on a host with an ephemeral
disk, and `CRON_SECRET` turns the cleanup endpoint on.

## Repository layout

```
app/                  routes (see rendering strategy above)
  admin/              the panel (layout + dashboard/shares/files/users/security/
                      storage/logs/settings/search)
  api/cron/cleanup/   the scheduled cleanup endpoint
  actions/share.ts    server actions: createCodeShare, createFileShare, verifyPin
  actions/admin.ts    panel actions (expire/delete/role/status/block/settings)
  actions/maintenance.ts  run cleanup / storage scan
components/
  admin/              panel tables, charts, forms, action buttons
  layout/MaintenanceBanner.tsx
  editor/             Monaco wrapper (client, ssr:false)
  file/               FileDrop (client)
  share/              ShareView (file list, gone states), DownloadLink,
                      DownloadAutoStart (resume after PIN), PreviewDownloadHint,
                      PinForm, PinInput, RouteField, CodeViewer, CopyButton,
                      ExpiryCountdown, RecentSlugs (homepage chips)
  auth/               AuthForm (login + sign-up)
  layout/             SiteHeader, AuthNav
  ui/                 shadcn-style primitives (button, input, label, card, badge)
lib/                  prisma singleton, auth, route rules, pin (bcrypt+HMAC),
                      download tokens, download gate, download error pages,
                      recent slugs (sessionStorage), file rules, schemas (zod),
                      storage, zip, expire, utils
  security/           client IP, rate limiter (memory + Upstash), events,
                      the guard, response headers
  admin/              global search
  cleanup/            the background job
  settings.ts         typed settings registry (maintenance, retention, cleanup)
prisma/               schema.prisma + migrations (hand-maintained SQL,
                      applied by scripts/db.mjs in offline dev)
scripts/              db.mjs (embedded pg), prisma.mjs (offline-safe generate),
                      seed.mjs (demo data)
tests/                Vitest unit/component/action tests
e2e/                  Playwright critical flows
```
