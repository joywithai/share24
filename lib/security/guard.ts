import { blockedInfo, blockIp, logSecurityEvent } from '@/lib/security/events';
import type { HeaderSource } from '@/lib/security/ip';
import { clientIp, UNKNOWN_IP } from '@/lib/security/ip';
import {
  describeRetry,
  enforceRateLimit,
  RATE_LIMITS,
  type RateLimitKind,
} from '@/lib/security/rate-limit';

/**
 * The gate every write action and every download goes through.
 *
 *     guardAction('create', { ip })        → server actions
 *     guardRequest(request, 'download')    → route handlers
 *
 * Three checks, cheapest first:
 *
 *   1. Is this address on the block list? (cached for a few seconds)
 *   2. Is it inside its rate limit for this kind of action?
 *   3. If it keeps hammering, block it for a while — by itself, with a reason,
 *      so the admin panel has something to show and the attack stops without
 *      anybody watching.
 */

export interface GuardResultOk {
  ok: true;
}

export interface GuardResultBlocked {
  ok: false;
  status: 403 | 429;
  /** Ready to show the visitor. */
  message: string;
  retryAfterSeconds: number;
}

export type GuardResult = GuardResultOk | GuardResultBlocked;

export interface GuardContext {
  ip: string;
  route?: string | null;
  userId?: string | null;
  userAgent?: string | null;
}

/** Addresses that keep tripping the limits get blocked by themselves. */
const AUTO_BLOCK_VIOLATIONS = 3;
const AUTO_BLOCK_WINDOW_MS = 10 * 60_000;
const AUTO_BLOCK_DURATION_MS = 15 * 60_000;

/** Fast path for repeated violations; the real window is the rate limiter's. */
const violations = new Map<string, { count: number; firstAt: number }>();

/** One "this address is blocked" log per address per minute, not per request. */
const lastBlockLog = new Map<string, number>();
const BLOCK_LOG_INTERVAL_MS = 60_000;

const BLOCKED_MESSAGE =
  'This address is blocked. If you believe that is a mistake, contact the operator.';

function countViolation(ip: string, now: number): number {
  const current = violations.get(ip);
  const entry =
    current && now - current.firstAt < AUTO_BLOCK_WINDOW_MS
      ? current
      : { count: 0, firstAt: now };
  entry.count += 1;
  violations.set(ip, entry);
  return entry.count;
}

/** Clear the auto-block bookkeeping — tests, and after an admin unblocks. */
export function clearViolations(ip?: string): void {
  if (ip === undefined) violations.clear();
  else violations.delete(ip);
}

export async function guardAction(
  kind: RateLimitKind,
  context: GuardContext,
): Promise<GuardResult> {
  const { ip } = context;
  const now = Date.now();

  // A request with no usable address is still rate limited (one shared
  // bucket), but never auto-blocked: that bucket is everybody behind the
  // same mis-configured proxy.
  if (ip !== UNKNOWN_IP) {
    const block = await blockedInfo(ip);
    if (block.blocked) {
      const lastLog = lastBlockLog.get(ip) ?? 0;
      if (now - lastLog > BLOCK_LOG_INTERVAL_MS) {
        lastBlockLog.set(ip, now);
        await logSecurityEvent({
          type: 'blocked_ip',
          severity: 'warning',
          ip,
          route: context.route ?? null,
          userId: context.userId ?? null,
          userAgent: context.userAgent ?? null,
          detail: `blocked request rejected (${kind})${block.reason ? ` — ${block.reason}` : ''}`,
        });
      }
      return {
        ok: false,
        status: 403,
        message: BLOCKED_MESSAGE,
        retryAfterSeconds: block.expiresAt
          ? Math.max(1, Math.ceil((block.expiresAt.getTime() - now) / 1000))
          : 0,
      };
    }
  }

  const limit = await enforceRateLimit(kind, ip, RATE_LIMITS[kind]);
  if (limit.ok) return { ok: true };

  const retryAfterSeconds = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
  await logSecurityEvent({
    type: 'rate_limit',
    severity: 'warning',
    ip,
    route: context.route ?? null,
    userId: context.userId ?? null,
    userAgent: context.userAgent ?? null,
    detail: `${kind}: ${limit.limit} per ${Math.round(RATE_LIMITS[kind].windowMs / 60000)} min exceeded`,
  });

  if (ip !== UNKNOWN_IP && countViolation(ip, now) >= AUTO_BLOCK_VIOLATIONS) {
    clearViolations(ip);
    const blocked = await blockIp({
      ip,
      reason: `repeated rate limit hits (${kind})`,
      durationMs: AUTO_BLOCK_DURATION_MS,
    });
    if (blocked) {
      await logSecurityEvent({
        type: 'blocked_ip',
        severity: 'critical',
        ip,
        route: context.route ?? null,
        detail: `auto-blocked for ${AUTO_BLOCK_DURATION_MS / 60000} minutes after repeated ${kind} requests`,
      });
    }
  }

  return {
    ok: false,
    status: 429,
    message: `Too many requests. Try again in ${describeRetry(limit.retryAfterMs)}.`,
    retryAfterSeconds,
  };
}

/**
 * The same guard for a route handler: `null` means "carry on", otherwise the
 * response to send back.
 */
export async function guardRequest(
  request: Request,
  kind: RateLimitKind,
  options: { route?: string | null } = {},
): Promise<Response | null> {
  const headers: HeaderSource = request.headers;
  const ip = clientIp(headers);
  const outcome = await guardAction(kind, {
    ip,
    route: options.route ?? null,
    userAgent: headers.get('user-agent'),
  });
  if (outcome.ok) return null;

  return new Response(
    JSON.stringify({
      error: outcome.message,
      retryAfter: outcome.retryAfterSeconds,
    }),
    {
      status: outcome.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...(outcome.status === 429
          ? { 'Retry-After': String(outcome.retryAfterSeconds) }
          : {}),
      },
    },
  );
}
