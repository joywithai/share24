/**
 * Share expiry — 24 hours, enforced with lazy (on-access) checks. V1 has no
 * cron job: a share is treated as expired when either `isExpired` is true or
 * `expiresAt` is in the past. The `isExpired` flag is flipped opportunistically
 * the next time the share is accessed.
 */

export const SHARE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** `expiresAt` for a share created at `createdAt`. */
export function expiryFrom(createdAt: Date = new Date()): Date {
  return new Date(createdAt.getTime() + SHARE_TTL_MS);
}

/** A share is expired when flagged OR when its expiry time has passed. */
export function isShareExpired(
  share: { isExpired: boolean; expiresAt: Date },
  now: Date = new Date(),
): boolean {
  return share.isExpired || share.expiresAt.getTime() <= now.getTime();
}

export function msUntil(date: Date, now: Date = new Date()): number {
  return date.getTime() - now.getTime();
}

/** "23h 14m", "9m 32s", "expired" — compact remaining-time label. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'expired';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
