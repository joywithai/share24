import type { SecurityEventType } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';

/**
 * The security trail.
 *
 * Everything here is best-effort: a database hiccup while *logging* must never
 * turn a normal request into a failure, so write errors are swallowed after a
 * console warning. The one thing that is enforced — the block list — is read
 * with a short cache, because the guard runs on every action and every
 * download.
 */

export type { SecurityEventType };

export type Severity = 'info' | 'warning' | 'critical';

export interface SecurityEventInput {
  type: SecurityEventType;
  severity?: Severity;
  ip?: string | null;
  route?: string | null;
  userId?: string | null;
  userAgent?: string | null;
  detail?: string | null;
}

/** Keep rows useful in an admin table: no walls of text, no control chars. */
const MAX_DETAIL_CHARS = 500;

function cleanDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to strip them.
  const stripped = detail.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return stripped.length > MAX_DETAIL_CHARS
    ? `${stripped.slice(0, MAX_DETAIL_CHARS)}…`
    : stripped;
}

/** Record one event. Never throws. */
export async function logSecurityEvent(
  event: SecurityEventInput,
): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        type: event.type,
        severity: event.severity ?? 'warning',
        ip: event.ip ?? null,
        route: event.route ?? null,
        userId: event.userId ?? null,
        userAgent: event.userAgent?.slice(0, 300) ?? null,
        detail: cleanDetail(event.detail),
      },
    });
  } catch (error) {
    console.warn('[security] could not record an event', error);
  }
}

// ---------------------------------------------------------------------------
// Blocked addresses
// ---------------------------------------------------------------------------

/** How long a cached "this address is blocked" answer may be reused. */
const BLOCK_CACHE_MS = 15_000;

interface BlockState {
  blocked: boolean;
  reason: string | null;
  expiresAt: Date | null;
  checkedAt: number;
}

const blockCache = new Map<string, BlockState>();
const MAX_BLOCK_CACHE_KEYS = 2_000;

export interface BlockInfo {
  blocked: boolean;
  reason: string | null;
  expiresAt: Date | null;
}

/**
 * Is this address blocked right now? Expired blocks answer `false` and are
 * cleaned up lazily (the cleanup job also sweeps them).
 */
export async function blockedInfo(ip: string): Promise<BlockInfo> {
  const cached = blockCache.get(ip);
  const now = Date.now();
  if (cached && now - cached.checkedAt < BLOCK_CACHE_MS) {
    if (!cached.blocked)
      return { blocked: false, reason: null, expiresAt: null };
    if (!cached.expiresAt || cached.expiresAt.getTime() > now) {
      return {
        blocked: true,
        reason: cached.reason,
        expiresAt: cached.expiresAt,
      };
    }
  }

  try {
    const row = await prisma.blockedIp.findUnique({
      where: { ip },
      select: { reason: true, expiresAt: true },
    });
    const blocked = Boolean(
      row && (!row.expiresAt || row.expiresAt > new Date()),
    );
    rememberBlock(ip, {
      blocked,
      reason: row?.reason ?? null,
      expiresAt: row?.expiresAt ?? null,
      checkedAt: now,
    });
    return blocked
      ? {
          blocked: true,
          reason: row?.reason ?? null,
          expiresAt: row?.expiresAt ?? null,
        }
      : { blocked: false, reason: null, expiresAt: null };
  } catch (error) {
    // The database is unreachable — do not lock everybody out over it.
    console.warn('[security] could not read the block list', error);
    return { blocked: false, reason: null, expiresAt: null };
  }
}

function rememberBlock(ip: string, state: BlockState): void {
  if (blockCache.size >= MAX_BLOCK_CACHE_KEYS) blockCache.clear();
  blockCache.set(ip, state);
}

export interface BlockInput {
  ip: string;
  reason?: string | null;
  /** `null` (or omitted) = permanent. */
  durationMs?: number | null;
  blockedBy?: string | null;
}

/** Add (or refresh) a block. Returns false when the write failed. */
export async function blockIp(input: BlockInput): Promise<boolean> {
  const expiresAt =
    input.durationMs && input.durationMs > 0
      ? new Date(Date.now() + input.durationMs)
      : null;

  try {
    await prisma.blockedIp.upsert({
      where: { ip: input.ip },
      create: {
        ip: input.ip,
        reason: cleanDetail(input.reason) ?? null,
        blockedBy: input.blockedBy ?? 'system',
        expiresAt,
      },
      update: {
        reason: cleanDetail(input.reason) ?? null,
        blockedBy: input.blockedBy ?? 'system',
        expiresAt,
      },
    });
    rememberBlock(input.ip, {
      blocked: true,
      reason: input.reason ?? null,
      expiresAt,
      checkedAt: Date.now(),
    });
    return true;
  } catch (error) {
    console.warn('[security] could not block an address', error);
    return false;
  }
}

export async function unblockIp(ip: string): Promise<boolean> {
  blockCache.delete(ip);
  try {
    await prisma.blockedIp.deleteMany({ where: { ip } });
    return true;
  } catch (error) {
    console.warn('[security] could not unblock an address', error);
    return false;
  }
}

/** Drop the cached answers — tests, and right after an admin change. */
export function clearBlockCache(): void {
  blockCache.clear();
}

/** Remove expired rows. Called by the cleanup job; safe to run any time. */
export async function sweepExpiredBlocks(): Promise<number> {
  try {
    const { count } = await prisma.blockedIp.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    blockCache.clear();
    return count;
  } catch (error) {
    console.warn('[security] could not sweep expired blocks', error);
    return 0;
  }
}
