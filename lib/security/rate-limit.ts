/**
 * Rate limiting.
 *
 * Two implementations behind one interface:
 *
 *   - `MemoryRateLimiter` — a fixed-window counter in process memory. Always
 *     available, correct for a single instance, and what a self-hosted V1 uses.
 *   - `UpstashRateLimiter` — the same windows inside an Upstash Redis database
 *     over its REST API, for deployments that run more than one instance (the
 *     in-memory counters of two lambdas cannot see each other). Enabled by
 *     setting `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; no
 *     dependency needed, it is a handful of `fetch` calls.
 *
 * If the Redis call fails, the limiter falls back to the in-memory window
 * instead of failing the request: a broken cache must not take the app down.
 */

export interface RateLimitRule {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Requests allowed inside one window. */
  max: number;
  /**
   * Count per address *and* per share rather than per address alone. Only PIN
   * attempts need this: one address guessing at two different shares is two
   * attacks, not one.
   */
  perRoute?: boolean;
}

/** A window in words — `1 hour`, `15 min`, `30 seconds`. */
export function describeWindow(windowMs: number): string {
  if (windowMs % 3_600_000 === 0) {
    const hours = windowMs / 3_600_000;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (windowMs % 60_000 === 0) return `${windowMs / 60_000} min`;
  return `${Math.max(1, Math.round(windowMs / 1000))} seconds`;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Milliseconds until the current window ends (0 when allowed and fresh). */
  retryAfterMs: number;
  resetAt: number;
}

export interface RateLimiter {
  hit(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
  /** Drop counters — all of them, or one key. */
  clear(key?: string): void;
}

/** How long a caller should wait, in words a human can act on. */
export function describeRetry(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  // "Try again in 60 minutes" reads worse than "in 1 hour", and the hourly
  // windows below are exactly where a caller meets this message.
  if (seconds >= 3600) {
    const hours = Math.ceil(seconds / 3600);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function result(
  rule: RateLimitRule,
  count: number,
  resetAt: number,
  now: number,
): RateLimitResult {
  const remaining = Math.max(0, rule.max - count);
  return {
    ok: count <= rule.max,
    limit: rule.max,
    remaining,
    retryAfterMs: count > rule.max ? Math.max(0, resetAt - now) : 0,
    resetAt,
  };
}

interface Window {
  count: number;
  resetAt: number;
}

/** Never let the map grow without bound in a long-lived process. */
const MAX_TRACKED_KEYS = 10_000;

export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly now: () => number = Date.now) {}

  async hit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const now = this.now();
    this.prune(now);

    const existing = this.windows.get(key);
    const window: Window =
      existing && existing.resetAt > now
        ? existing
        : { count: 0, resetAt: now + rule.windowMs };
    window.count += 1;
    this.windows.set(key, window);

    return result(rule, window.count, window.resetAt, now);
  }

  clear(key?: string): void {
    if (key === undefined) this.windows.clear();
    else this.windows.delete(key);
  }

  /** Number of live windows — used by the admin panel and tests. */
  size(): number {
    return this.windows.size;
  }

  private prune(now: number): void {
    if (this.windows.size < MAX_TRACKED_KEYS) return;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
    // Still full of live windows? Drop the oldest half rather than grow.
    if (this.windows.size >= MAX_TRACKED_KEYS) {
      const keys = [...this.windows.keys()].slice(
        0,
        Math.floor(this.windows.size / 2),
      );
      for (const key of keys) this.windows.delete(key);
    }
  }
}

interface UpstashOptions {
  url: string;
  token: string;
  fallback: RateLimiter;
  fetchImpl?: typeof fetch;
  /** Give up on Redis after this long and count in memory instead. */
  timeoutMs?: number;
}

/** An unreachable Redis must never hold a request open. */
const DEFAULT_UPSTASH_TIMEOUT_MS = 1500;

/**
 * Counters in Upstash Redis, spoken over its REST pipeline endpoint:
 *
 *     SET <key> 0 EX <window> NX   → create the window once
 *     INCR <key>                   → this request's count
 *     TTL <key>                    → seconds left in the window
 *
 * `INCR` after a `SET NX` is safe: whichever instance creates the key, every
 * instance counts on the same key, and the TTL only belongs to the creation.
 */
export class UpstashRateLimiter implements RateLimiter {
  constructor(private readonly options: UpstashOptions) {}

  async hit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const seconds = Math.max(1, Math.ceil(rule.windowMs / 1000));
    try {
      return await this.redisHit(key, rule, seconds);
    } catch (error) {
      console.warn('[security] rate limit backend unavailable', error);
      return this.options.fallback.hit(key, rule);
    }
  }

  clear(key?: string): void {
    this.options.fallback.clear(key);
  }

  private async redisHit(
    key: string,
    rule: RateLimitRule,
    seconds: number,
  ): Promise<RateLimitResult> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_UPSTASH_TIMEOUT_MS;
    const response = await doFetch(`${this.options.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['SET', key, '0', 'EX', String(seconds), 'NX'],
        ['INCR', key],
        ['TTL', key],
      ]),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`upstash responded ${response.status}`);
    }

    const payload = (await response.json()) as { result?: unknown }[];
    const count = Number(payload[1]?.result ?? 0);
    const ttl = Number(payload[2]?.result ?? seconds);
    if (!Number.isFinite(count) || count <= 0) {
      throw new Error('upstash returned an unusable count');
    }

    const now = Date.now();
    const ttlMs = (Number.isFinite(ttl) && ttl > 0 ? ttl : seconds) * 1000;
    return result(rule, count, now + ttlMs, now);
  }
}

/**
 * The rules, in one place so the admin panel can show and reason about them.
 * `create`, `upload`, `pin` and `login` are deliberately tight — they write to
 * the database, or they are guesses an attacker would script.
 *
 * The friendly names in `lib/rate-limit/index.ts` (`createShare`, `uploadFile`,
 * `verifyPin`, `download`, `login`) map one-to-one onto these keys.
 */
export const RATE_LIMITS = {
  /** Creating a *code* share — per address, 10 per hour. */
  create: { windowMs: 60 * 60_000, max: 10 },
  /** Uploading files to a share — per address, 20 per hour. */
  upload: { windowMs: 60 * 60_000, max: 20 },
  /** PIN attempts — per address *and* share, 5 per minute. */
  pin: { windowMs: 60_000, max: 5, perRoute: true },
  /** Downloads — per address, 30 per hour. */
  download: { windowMs: 60 * 60_000, max: 30 },
  /** Sign-in attempts — per address, 5 per 15 minutes. */
  login: { windowMs: 15 * 60_000, max: 5 },
  /** Cheap read-only actions (route availability checks). */
  lookup: { windowMs: 60_000, max: 120 },
} as const;

export type RateLimitKind = keyof typeof RATE_LIMITS;

let limiter: RateLimiter | null = null;

/** The limiter for this process: Redis when configured, memory otherwise. */
export function getRateLimiter(): RateLimiter {
  if (limiter) return limiter;

  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const memory = new MemoryRateLimiter();

  limiter =
    url && token
      ? new UpstashRateLimiter({
          url,
          token,
          fallback: memory,
        })
      : memory;
  return limiter;
}

/** Replace (or clear) the limiter — tests, and after an env change. */
export function setRateLimiter(next: RateLimiter | null): void {
  limiter = next;
}

/** Count one request against a rule. `identifier` is usually an IP. */
export async function enforceRateLimit(
  kind: RateLimitKind,
  identifier: string,
  rule: RateLimitRule = RATE_LIMITS[kind],
): Promise<RateLimitResult & { key: string }> {
  const key = `corium:rl:${kind}:${identifier}`;
  const outcome = await getRateLimiter().hit(key, rule);
  return { ...outcome, key };
}

/**
 * The identifier a rule counts against: the address, plus the route for rules
 * that are scoped per share (`pin`).
 */
export function rateLimitIdentifier(
  kind: RateLimitKind,
  ip: string,
  route?: string | null,
): string {
  const rule: RateLimitRule = RATE_LIMITS[kind];
  return rule.perRoute && route ? `${ip}:${route}` : ip;
}
