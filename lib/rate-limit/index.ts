import {
  describeRetry,
  enforceRateLimit,
  type RateLimitKind,
  type RateLimitResult,
  rateLimitIdentifier,
} from '@/lib/security/rate-limit';

/**
 * The rate limits, by the name of the thing they protect.
 *
 * One place answers "what is the limit on X?", and one source of truth holds
 * the numbers: `RATE_LIMITS` in `lib/security/rate-limit.ts`. This module only
 * gives those windows the friendly names the app talks about, so calling code
 * reads as the feature it is guarding:
 *
 *     await checkRateLimit('createShare', ip)            // 10 per hour per IP
 *     await checkRateLimit('uploadFile', ip)             // 20 per hour per IP
 *     await checkRateLimit('verifyPin', ip, { route })   // 5 per minute per IP + route
 *     await checkRateLimit('download', ip)               // 30 per hour per IP
 *     await checkRateLimit('login', ip)                  // 5 per 15 minutes per IP
 *
 * The server actions and the download routes go through
 * `guardAction()`/`guardRequest()` (`lib/security/guard.ts`) rather than
 * calling this directly — the guard adds the block list, the security event and
 * the automatic block on top of the same counters. Reach for these helpers when
 * you need the count without the guard, or in a test.
 *
 * **Redis or memory.** With `UPSTASH_REDIS_REST_URL` and
 * `UPSTASH_REDIS_REST_TOKEN` set, the counters live in Upstash Redis and are
 * shared by every instance (that is what a serverless deployment needs). With
 * them unset — local development, a single self-hosted server — the same
 * windows are counted in process memory. Pointing the variables at an
 * unreachable Redis is survivable too: the request falls back to the in-memory
 * window after a short timeout instead of failing.
 */

/** Friendly name → the rule it uses. */
export const RATE_LIMIT_PROFILES = {
  createShare: { kind: 'create', per: 'IP' },
  uploadFile: { kind: 'upload', per: 'IP' },
  verifyPin: { kind: 'pin', per: 'IP + route' },
  download: { kind: 'download', per: 'IP' },
  login: { kind: 'login', per: 'IP' },
} as const satisfies Record<string, { kind: RateLimitKind; per: string }>;

export type RateLimitProfile = keyof typeof RATE_LIMIT_PROFILES;

export interface RateLimitHit extends RateLimitResult {
  /** The counter that was incremented — useful in logs and tests. */
  key: string;
  profile: RateLimitProfile;
  /** `false` means the caller is over the limit and must be refused. */
  ok: boolean;
  /** A sentence for the visitor, e.g. `Too many requests. Try again in 1 hour.` */
  message: string;
}

/**
 * Count one request against a profile. `identifier` is the client address;
 * `route` is required by the profiles whose `per` includes it.
 */
export async function checkRateLimit(
  profile: RateLimitProfile,
  identifier: string,
  options: { route?: string | null } = {},
): Promise<RateLimitHit> {
  const { kind } = RATE_LIMIT_PROFILES[profile];
  const outcome = await enforceRateLimit(
    kind,
    rateLimitIdentifier(kind, identifier, options.route ?? null),
  );

  return {
    ...outcome,
    profile,
    message: outcome.ok
      ? 'Allowed.'
      : `Too many requests. Try again in ${describeRetry(outcome.retryAfterMs)}.`,
  };
}

/** The three read-only call sites that only need a yes/no answer. */
export async function isRateLimited(
  profile: RateLimitProfile,
  identifier: string,
  options: { route?: string | null } = {},
): Promise<boolean> {
  const hit = await checkRateLimit(profile, identifier, options);
  return !hit.ok;
}

export {
  describeRetry,
  describeWindow,
  enforceRateLimit,
  getRateLimiter,
  MemoryRateLimiter,
  RATE_LIMITS,
  type RateLimitKind,
  type RateLimitResult,
  type RateLimitRule,
  rateLimitIdentifier,
  setRateLimiter,
  UpstashRateLimiter,
} from '@/lib/security/rate-limit';
