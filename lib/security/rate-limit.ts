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
}

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
 * `create` and `pin` are deliberately tight — both write to the database and
 * both are things an attacker would script.
 */
export const RATE_LIMITS = {
  /** Creating a share (code or file) — per address. */
  create: { windowMs: 10 * 60_000, max: 20 },
  /** PIN attempts — per address and route. */
  pin: { windowMs: 10 * 60_000, max: 8 },
  /** Downloads — per address. Generous: one ZIP plus each file of a set. */
  download: { windowMs: 60_000, max: 60 },
  /** Cheap read-only actions (route availability checks). */
  lookup: { windowMs: 60_000, max: 120 },
  /** Auth endpoints in front of Better Auth. */
  auth: { windowMs: 60_000, max: 30 },
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
