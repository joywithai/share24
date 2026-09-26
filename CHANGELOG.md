# Changelog

Every change that shipped on top of the initial upload round, newest first.
Dates are the day the commit landed (`git log --oneline`); the hash after each
heading is the commit itself. Features are described by what a visitor can do,
not by which file moved.

Base: `5a588f7` — *upload UX round* — bigger drop area, block-list upload rules
(archives / executables / web pages / media), live route-availability check.

## Phase 2 — Security hardening

The app now assumes somebody will try. Everything here is invisible to a
normal visitor and loud for everyone else.

- **Rate limits on the things that cost something.** Creating a share (20 per
  10 minutes per address), PIN attempts (8 per 10 minutes per address *and*
  route), downloads (60 per minute) and the live route probe (120 per minute).
  Counters live in memory by default; point `UPSTASH_REDIS_REST_URL` /
  `UPSTASH_REDIS_REST_TOKEN` at Upstash Redis and they are shared across
  instances — with a fall back to memory if Redis is unreachable, because a
  broken cache must not take the app down.
- **An address that keeps hammering blocks itself.** Three violations inside
  ten minutes and the IP is denied for fifteen minutes, with a reason, and the
  block is checked (with a 15-second cache) before every action and download.
  `SecurityEvent` and `BlockedIp` are new tables; the admin panel in phase 3
  reads them.
- **Uploads are checked by their bytes, not their names.** `lib/file-magic.ts`
  compares the first 8 KB against the extension and the declared MIME type, so
  a renamed archive, a disguised executable and a `.png` that is really HTML
  are all refused — and logged as `suspicious_upload`.
- **Names are cleaned before they are stored.** `sanitizeDisplayName` drops
  control and bidi-override characters (the `invoice‮gnp.exe` trick), path
  separators and absurd lengths; ZIP entry names got the same treatment plus a
  180-character cap.
- **Answers to abuse explain themselves.** 429 (with `Retry-After`) and 403
  render the same small self-contained page the download failures use.
- **Auth is rate limited** in Better Auth itself (10 sign-ins/minute, 5
  sign-ups/5 minutes), and login failures are recorded.
- **CSP and friends.** `Content-Security-Policy` (no external script/style/
  frame/connect), `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, HSTS in production, and `X-Powered-By` turned off. The
  app deliberately does **not** send `frame-ancestors`/`X-Frame-Options`: it is
  meant to run inside the preview and any self-hoster's proxy — see
  DEPLOYMENT.md for the one line to add if you serve it top-level.

Tests: 187 → 224.

## The create button moves up on the code page too

`/create/code` still put "Create share" at the very bottom, under a 420px
editor — the same place `/create/file` was fixed earlier. The button and its
hint line now live in the Route/PIN card, so both create pages read the same
way: name the route, set a PIN if you want, create the share, then fill in the
content.

The hint follows what is on the page: "Write or paste your code below — then
create the share." while the editor is empty, "Self-destructs 24 hours after
creation." once there is something to share.

## Phase 1 — Storage that can leave the disk (Cloudflare R2)

The production roadmap's first phase: uploads no longer assume "the file is on
this machine".

- **One contract, two providers.** `lib/storage/` defines `StorageProvider`
  (`save` / `get` / `exists` / `delete` / `deleteShare`) with a local-disk
  implementation (the V1 default) and a Cloudflare R2 one (S3 API,
  `@aws-sdk/client-s3`). Uploads, both download routes and the ZIP writer go
  through it; nothing else touches the filesystem.
- **The switch is safe by row, not by deploy.** `ShareFile` gained
  `storageType` (`LOCAL` by default) plus `r2Key` / `r2Bucket`. New uploads follow
  `STORAGE_TYPE`, but every download is served by the provider recorded on the
  row itself — so flipping to R2 cannot orphan the shares that are already up,
  and a R2 outage only affects R2 rows. `SystemSetting` (a small key/value table)
  arrived with the same migration.
- **Object names stay human.** `<shareId>/<nn>-<name>.<ext>` for both providers,
  with the same sanitising as before and the extension taken from the sanitized
  name (a device name like `...hidden` can no longer produce an odd suffix).
- **Failures are honest.** A provider that fails halfway removes its own partial
  writes, a failed database step removes the whole share's bytes, and bytes that
  are gone still render the explained 410 page instead of an empty archive.
- **Tests grew from 155 to 187**: provider behaviour on a real temporary root,
  the R2 contract against a recording S3 client (keys, buckets, error mapping,
  cleanup, signing), ZIP entries from remote sources, and availability checks.

## `cd973dd` — Downloads that explain themselves (and survive a restart)

Reported again as “nothing downloads”. The links were verified fine (every
rendered URL answered `200` with the exact bytes, Bengali file names included),
but two habits of a self-hosted dev setup turned a working app into a silent
dead end, and one real UI gap was found:

- **Uploads no longer live in `/tmp`.** The default for local development is
  `./.uploads`, next to the database data, so restarting the dev server (or the
  container) cannot empty the storage while the share rows survive. Set it in
  `.env` / `bootstrap` (`.env.example`, `scripts/dev-bootstrap.sh`,
  `.gitignore`, README).
- **A download that cannot be served now explains itself.** The routes check
  the bytes are still on disk before answering; only files that exist go into a
  ZIP (the header button reads “Download the rest (.zip)” when some are gone),
  and every failure — expired share, wiped folder, missing single file, a file
  id from another share, inconsistent metadata — renders a small self-contained
  HTML page with the reason plus two ways out (*Share files again* / *Back to
  the start*) instead of a bare `text/plain` sentence. Status codes stay
  honest: `410` gone, `404` wrong share, `500` inconsistent.
- **The file name in a list is a download link too**, not only the button, so
  clicking a name does something.
- **A share with no bytes left says so on the page** (“Gone”, no dead button;
  a full panel when nothing is left) instead of offering buttons that end on an
  error page.
- **Inside an embedded preview** the page adds a one-line hint for sandboxes
  that swallow downloads (right-click → *Open link in new tab*, or open the app
  in its own tab).

Tests: `keepAvailable`, the failure pages (status, HTML escaping, the way out),
the gone states in the file list, and the clickable names — 155 total.

## `11c5dea` — `/create/file`: name and PIN first

The drop zone is tall, so the route/PIN card and the *Create share* button used
to sit below the fold. Now the order on the page is: **Route + PIN** card →
*Create share* (same card, under a hairline rule) → **Files** drop zone. While
no files are picked the hint next to the button says “Add your files below —
then create the share.”; afterwards it goes back to the storage note. The
button still stays disabled until at least one file is chosen.

## `f74ebbf` — “Your slugs”: the homepage remembers this browser

- Creating a share (code or files) **lands back on the homepage** instead of the
  share page.
- Under the name box the homepage lists the slugs *this browser* created as
  chips, newest first: click one to copy its full link (with a Copied / Copy
  failed state), arrows appear once the strip overflows, `‹ ›` disable at the
  edges, and the whole section is hidden when there is nothing to show.
- Storage is `sessionStorage` + a timestamp: gone when the tab closes, and each
  entry expires with its share after 24 h. **No database query, nothing sent
  anywhere.** An in-memory fallback keeps it working where `sessionStorage` is
  blocked (sandboxed iframes, private mode), and corrupt/future entries are
  ignored.

## `feca1c6` — Downloads work inside the embedded preview

A same-frame download is silently blocked by the surrounding sandbox (the click
lands, the response arrives, nothing is saved). `DownloadLink` adds
`target="_blank"` + `rel="noopener"` **only when the page is embedded**, after
mount, so a normal deployment keeps downloading in place and the server markup
is unchanged.

## `7090d6b` — PIN-protected downloads no longer bounce back to the form

Downloading from an unlocked share could return the visitor to the PIN form
when the unlock cookie never made it back (proxy stripping `Set-Cookie`,
third-party-cookie refusal, rotated secret). Unlocked pages now mint a
short-lived, HMAC-signed `?k=` token into each download URL, scoped to that
route and to either the whole share or one file (`lib/download-token.ts`). If
neither cookie nor token is valid the visitor is sent to the share page with
`?download=<scope>`, and the download resumes by itself once the PIN is
accepted.

## `7066a9e` — Multi-file shares

1–10 files per route (10 MB each, 50 MB per share, same block-list rules),
stored in a new `ShareFile` table with a migration. `/<route>/download` serves
a single file as itself and bundles several into a streamed ZIP
(`lib/zip.ts`, `node:zlib`, no ZIP64); `/<route>/download/<fileId>` serves one
file and only when it belongs to that share. The share page lists one row per
file with its own download button, plus “Download all (.zip)”, and the create
page manages the picker, per-file errors and the 50 MB budget.

## `441bc9b` — Landing somewhere after login, and honest cursors

Sign-in / sign-up finished without navigating (the soft navigation left the
visitor on the form) — now a full-page navigation lands on the target page.
Every clickable button and `[role="button"]` shows a pointer cursor, and
disabled controls show `not-allowed`.

## `81438f5` — Homepage: actions under the name box

The “Share code” / “Share a file” cards moved directly under the Go box, with
the how-it-works steps below them, so the page opens on the thing you came to
do.

## `9bfe826` — Homepage steps as a flow, not boxes

The three steps read as a numbered one-two-three flow (connected markers)
instead of three boxed cards, and the two action cards got the premium
treatment (gradient hairline, icon plate, arrow that slides on hover).

## `201c6a3` — Give the route field room

`sharetofnd.example/` collapsed into a small host chip so long routes stay
readable; the 4-digit PIN column became noticeably narrower than a full-width
field; the row reflows to one column on small screens.

## `036f6cf` — Caret position and the 4-box PIN

In the code editor the caret sat one character to the left of what had been
typed (CSS padding on `.view-lines`) — fixed, so the caret tracks the text.
The PIN became four discrete boxes with paste/arrow-key handling, next to a
refined route field.

## `b6b16c0` — Premium Go button

The homepage submit control became an inset pill with an arrow that slides on
hover; the 404 page got a cleaner pair of actions.

## `e2ef874` — Scrolling, open-by-name, 404 back button

The mouse wheel scrolls the page over the editor again instead of being trapped
by it; the homepage gained the “open by name” box (paste a slug, jump straight
there); the 404 page gained a Back button.

## `c3370c4` — Lint cleanup

Biome clean: stable wheel callback, semantic markup for the route spinner.

---

## Notes kept for whoever continues this

- **Testing at the tip of this log:** `npm test` → 155 tests (unit, component,
  server actions with a mocked database and real file I/O), `npx tsc --noEmit`
  clean, `npm run lint` (Biome) clean. Playwright e2e exists but needs a
  browser download, which offline sandboxes block.
- **Ephemeral sandboxes:** uploads in `/tmp`, an embedded database in `./.pg`,
  and the dev server itself all disappear when the sandbox is reset, while the
  browser keeps an old page open — that is the “nothing downloads” report in
  its usual disguise. The app now answers such a click with an explained page;
  a fresh share always works.
- **Deliberately not in V1:** view counts/analytics, edit or delete a share,
  permanent links, teams, light mode, more than 10 files per share, rate
  limiting, S3/CDN storage.
