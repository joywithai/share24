# Sharetofnd (share24)

Temporary sharing for developers — somewhere between Pastebin and WeTransfer,
but minimal. Give it a route, get a link. Everything self-destructs after
**24 hours**. No account required (optional login just collects your shares on
one page).

```
something to share → no signup, no forms → paste it + pick a route → link
→ the share dies in 24h (soft-deleted, lazy check, no cron)
```

## V1 features

- **Code sharing** — Monaco editor (bundled, no CDN), plain text, 200 KB cap
- **File sharing** — drag & drop; PNG, JPG, WEBP, PDF, TXT, DOC, DOCX; 10 MB cap
- **Custom routes** — `/{a-z0-9_-}` 3–50 chars; reserved words blocked; a route
  is free again as soon as the previous share expires
- **Optional 4-digit PIN** — bcrypt-hashed; unlocking mints a short-lived,
  HMAC-signed cookie for that route (creator auto-unlocks on creation)
- **24-hour expiry** — lazy evaluation on access; `isExpired` flag flipped
  opportunistically (no cron)
- **Anonymous or signed in** — Better Auth (email + password); `/profile`
  lists your shares with live status
- **Dark, minimal UI** — fixed palette, 1000px centered layout

### Deliberately not in V1

view counts/analytics, edit share, manual delete, permanent links, teams,
light mode, multiple files per share, rate limiting, S3/CDN file storage.

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

# 2. Generate the Prisma client (Rust-free generator — no engine downloads)
npm run db:generate

# 3. (Optional) seed a demo user + sample shares
npm run db:seed           # demo@sharetofnd.dev / password123

# 4. Run the app
npm run dev               # http://localhost:3000
```

Copy `.env.example` to `.env` (step 0 above) — the defaults already point at the
embedded database, so only `BETTER_AUTH_SECRET` needs a real value. If you
prefer your own Postgres (local or Neon), just set `DATABASE_URL` — and apply
the schema with `npx prisma migrate deploy` (the migration SQL lives in
`prisma/migrations/`).

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
| `npm run db:generate` | Generate the Prisma client (offline-safe wrapper)         |
| `npm run db:seed`     | Demo user + sample shares (active code, active file, expired) |
| `npm test`            | Vitest: unit + component + server-action tests (72)       |
| `npm run e2e`         | Playwright: the 3 critical flows (needs `npx playwright install chromium`) |
| `npm run lint`        | Biome check                                               |

## Environment variables

| Variable             | Required | Notes |
| -------------------- | -------- | ----- |
| `DATABASE_URL`       | yes      | PostgreSQL connection string (embedded dev default in `.env.example`) |
| `BETTER_AUTH_SECRET` | yes      | Random 32+ byte hex — session cookies, unlock-token HMAC |
| `NEXT_PUBLIC_APP_URL`| prod     | Public URL; Better Auth cookie scoping. Leave empty locally |
| `CORIUM_UPLOADS_DIR` | no       | Upload storage root, default `/tmp/corium-uploads` |
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
/               Server Component, static (two buttons only)
/create/code    Client Component — Monaco, RHF state
/create/file    Client Component — drag & drop, RHF state
/[route]        Server Component — DB checks → 404 | expired | PIN form | content
/[route]/download  Route Handler — serves the stored file (PIN-gated)
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
→ bcrypt hash if PIN → insert (expiresAt = now + 24h) → redirect to /route
→ viewer: server fetches share → expired? flag check + timestamp check
→ PIN? unlock cookie (HMAC) → content
```

### Database (Prisma)

`User`, `Session`, `Account`, `Verification` (Better Auth standard schema) plus:

```
Share: id, type(code|file), route, content?, fileUrl?, pinHash?,
       expiresAt, isExpired, userId?, createdAt
File:  id, shareId(unique), fileName, fileSize, mimeType
```

Route uniqueness is enforced by query (`route` + `isExpired = false` +
`expiresAt > now`) inside the create transaction — expired shares release
their routes automatically.

### Expiry (no cron)

On every access the page checks **both** `isExpired` and `expiresAt <= now`.
If the timestamp has passed, the flag is flipped in the same request and the
expired panel renders.

### File storage (V1)

`<uploads root>/<shareId>/<shareId><ext>` — paths are generated server-side
(random UUIDs), never derived from user input; the download handler re-resolves
stored paths against the uploads root (traversal-safe).

## Security notes

- Routes: `/^[a-z0-9_-]{3,50}$/` + reserved list (`api`, `auth`, `login`,
  `register`, `create`, `profile`, `favicon`, `robots`, `sitemap`, `_next`, …)
- PINs stored bcrypt-only; unlock cookies are HMAC-SHA256 signed, per-route,
  ≤ 1 h, httpOnly, SameSite=Lax
- Server-side re-validation of everything (schemas, file type/size, routes)
- Files: extension allow-list + declared-MIME cross-check (deep magic-byte
  validation is a V2 item), 10 MB cap
- Code is rendered in a read-only Monaco instance (never `dangerouslySetInnerHTML`)
- SQL through Prisma only (parameterized); no raw SQL except dev scripts
- V1 has **no rate limiting** on PIN attempts (documented gap, V2)

## Testing

```bash
npm test                    # 72 tests: route/pin/file/expire/schema rules,
                            # server actions (mocked DB, real file I/O),
                            # UI components (jsdom)
npm run e2e                 # Playwright: code round-trip, file download,
                            # PIN wrong→correct
```

Playwright needs a browser (`npx playwright install chromium`) and a running
app + database. It is not run in CI-less offline sandboxes.

## Deployment (Vercel + Neon)

1. `npm i -g vercel && vercel` (or the Vercel dashboard)
2. Set `DATABASE_URL` (Neon), `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`
3. Apply migrations in an environment with network access:
   `npx prisma migrate deploy`
4. Files live in `/tmp` on Vercel — **ephemeral** (cold starts may drop
   uploads; the download route returns a polite 410 in that case). S3/R2
   storage is the V2 fix.

## Repository layout

```
app/                  routes (see rendering strategy above)
  actions/share.ts    server actions: createCodeShare, createFileShare, verifyPin
components/
  editor/             Monaco wrapper (client, ssr:false)
  file/               FileDrop (client)
  share/              ShareView, PinForm, CodeBlock, CopyButton, ExpiryCountdown
  auth/               AuthForm (login + sign-up)
  layout/             SiteHeader, AuthNav
  ui/                 shadcn-style primitives (button, input, label, card, badge)
lib/                  prisma singleton, auth, route rules, pin (bcrypt+HMAC),
                      file rules, schemas (zod), storage, expire, utils
prisma/               schema.prisma + migrations (hand-maintained SQL,
                      applied by scripts/db.mjs in offline dev)
scripts/              db.mjs (embedded pg), prisma.mjs (offline-safe generate),
                      seed.mjs (demo data)
tests/                Vitest unit/component/action tests
e2e/                  Playwright critical flows
```
