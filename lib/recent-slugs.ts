import { SHARE_TTL_MS } from '@/lib/expire';
import { ROUTE_REGEX } from '@/lib/route';

/**
 * "Your slugs" — the names this browser created, newest first.
 *
 * Deliberately local and database-free: the list lives in `sessionStorage`, so
 * it disappears with the tab, and every entry carries the time it was created
 * so it also dies with the share it points at (24 h). Nothing is sent to the
 * server, and nothing here is proof that a share still exists — it is a
 * convenience list, not a source of truth.
 */

export const RECENT_SLUGS_KEY = 'corium:recent-slugs';

/** How many chips a visitor can accumulate before the oldest drop off. */
export const MAX_RECENT_SLUGS = 12;

export interface RecentSlug {
  slug: string;
  /** Creation time (ms) — entries expire with the share. */
  at: number;
}

/**
 * Used when `sessionStorage` is off-limits (sandboxed iframe without
 * `allow-same-origin`, Safari private mode, storage disabled). It only lasts as
 * long as the page's JS, but that is enough to show a slug right after a
 * client-side redirect to the homepage.
 */
let memory: RecentSlug[] = [];

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isEntry(value: unknown): value is RecentSlug {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<RecentSlug>;
  return (
    typeof entry.slug === 'string' &&
    ROUTE_REGEX.test(entry.slug) &&
    typeof entry.at === 'number' &&
    Number.isFinite(entry.at)
  );
}

/** Newest first, duplicates collapsed, expired or future-dated entries dropped. */
function tidy(entries: readonly RecentSlug[], now: number): RecentSlug[] {
  const seen = new Set<string>();
  const out: RecentSlug[] = [];
  for (const entry of entries) {
    if (seen.has(entry.slug)) continue;
    // Older than a share's lifetime → the share is gone too.
    if (now - entry.at >= SHARE_TTL_MS) continue;
    // A timestamp from the future means a mangled entry (or a tampered one).
    if (entry.at > now + 60_000) continue;
    seen.add(entry.slug);
    out.push({ slug: entry.slug, at: entry.at });
    if (out.length >= MAX_RECENT_SLUGS) break;
  }
  return out;
}

/** `null` means "no usable storage" (as opposed to "empty list"). */
function readStore(): RecentSlug[] | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = JSON.parse(store.getItem(RECENT_SLUGS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(isEntry) : [];
  } catch {
    // Corrupt value — start over rather than throwing on the homepage.
    return [];
  }
}

function writeStore(entries: readonly RecentSlug[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(RECENT_SLUGS_KEY, JSON.stringify(entries));
  } catch {
    // Quota or disabled storage: the in-memory copy still serves this page.
  }
}

/** The live list, with expired entries pruned (and the store tidied up). */
export function readRecentSlugs(now: number = Date.now()): RecentSlug[] {
  const stored = readStore();
  const source = stored ?? memory;
  const live = tidy(source, now);
  memory = live;
  if (stored && live.length !== stored.length) writeStore(live);
  return live;
}

/** Records a freshly created slug and returns the updated list. */
export function rememberSlug(
  slug: string,
  now: number = Date.now(),
): RecentSlug[] {
  if (!ROUTE_REGEX.test(slug)) return readRecentSlugs(now);
  const live = tidy([{ slug, at: now }, ...readRecentSlugs(now)], now);
  memory = live;
  writeStore(live);
  return live;
}
