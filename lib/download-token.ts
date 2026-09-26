import { createHmac, timingSafeEqual } from 'node:crypto';

import { UNLOCK_TTL_MS } from '@/lib/pin';

/**
 * Proof-of-access tokens for downloads.
 *
 * The unlock cookie is the primary key to a PIN-protected share, but a cookie
 * can go missing between the page render and the click: a proxy that strips
 * `Set-Cookie`, a browser refusing third-party cookies, an iframe preview, or
 * simply a rotated secret after a redeploy. When that happens a visitor who
 * *is* looking at the unlocked page would be bounced back to the PIN form for
 * every download — an infuriating loop with no way out.
 *
 * So the share page — which only renders at all once access was granted —
 * mints a short-lived token into each download URL. The download routes accept
 * that token as an alternative to the cookie, which makes the links work on
 * their own.
 *
 * Tokens are scoped: `all` opens the whole share, a file id opens exactly that
 * file, and neither works for any other route.
 */

function secret(): string {
  return (
    process.env.UNLOCK_SECRET ??
    process.env.BETTER_AUTH_SECRET ??
    'corium-dev-only-secret'
  );
}

/** `all` (the whole share) or a file id. */
export type DownloadScope = string;

export const DOWNLOAD_SCOPE_ALL: DownloadScope = 'all';

/** Token format: base64url(`dl|<scope>|<route>|<validUntilMs>`) + "." + hmac */
export function createDownloadToken(
  route: string,
  scope: DownloadScope,
  validUntilMs: number = Date.now() + UNLOCK_TTL_MS,
): string {
  const payload = `dl|${scope}|${route}|${validUntilMs}`;
  const mac = createHmac('sha256', secret())
    .update(payload)
    .digest('base64url');
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${mac}`;
}

export function isValidDownloadToken(
  token: string,
  route: string,
  scope: DownloadScope,
  now: number = Date.now(),
): boolean {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return false;

  let payload: string;
  try {
    payload = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
  } catch {
    return false;
  }

  const expected = createHmac('sha256', secret())
    .update(payload)
    .digest('base64url');
  const provided = token.slice(dot + 1);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  // Payload is `dl|<scope>|<route>|<validUntilMs>` — the route itself may
  // contain `|`? No: routes are `[a-z0-9_-]`, so splitting on the first three
  // separators is unambiguous.
  const [kind, tokenScope, tokenRoute, validUntil] = payload.split('|');
  if (kind !== 'dl') return false;
  if (tokenScope !== scope) return false;
  if (tokenRoute !== route) return false;
  return Number(validUntil) > now;
}

/**
 * How long a freshly minted token may live: never past the share's own expiry,
 * and never longer than the unlock window.
 */
export function downloadTokenExpiry(shareExpiresAt: Date): number {
  return Math.min(shareExpiresAt.getTime(), Date.now() + UNLOCK_TTL_MS);
}
