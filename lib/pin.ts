import { createHmac, timingSafeEqual } from 'node:crypto';

import bcrypt from 'bcryptjs';

/**
 * PIN protection (server-only — uses node:crypto and bcrypt).
 *
 *  - PINs are 4 digits and are stored only as a bcrypt hash (`pinHash`).
 *  - After a successful verification the browser receives a short-lived,
 *    HMAC-signed "unlock" cookie for that route, so the creator/viewer can
 *    keep browsing and downloading the share without re-entering the PIN.
 *
 * The pure PIN rule (`isValidPin`) lives in `lib/schemas.ts` so client
 * components can validate without importing node builtins.
 */
export { isValidPin, PIN_REGEX } from './schemas';

const BCRYPT_ROUNDS = 10;

/** An unlocked view is good for at most one hour (or until the share
 * expires, whichever is sooner — enforced at cookie creation time). */
export const UNLOCK_TTL_MS = 60 * 60 * 1000;

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

export async function verifyPin(
  pin: string,
  pinHash: string,
): Promise<boolean> {
  return bcrypt.compare(pin, pinHash);
}

function secret(): string {
  return (
    process.env.UNLOCK_SECRET ??
    process.env.BETTER_AUTH_SECRET ??
    'corium-dev-only-secret'
  );
}

/** Token format: base64url(`${route}|${validUntilMs}`) + "." + base64url(hmac) */
export function createUnlockToken(
  route: string,
  validUntilMs: number = Date.now() + UNLOCK_TTL_MS,
): string {
  const payload = `${route}|${validUntilMs}`;
  const mac = createHmac('sha256', secret())
    .update(payload)
    .digest('base64url');
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${mac}`;
}

export function isValidUnlockToken(
  token: string,
  route: string,
  now: number = Date.now(),
): boolean {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return false;
  const payloadPart = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  // The payload part is base64url-encoded; the HMAC was computed over the
  // decoded payload — decode first, then verify.
  let payload: string;
  try {
    payload = Buffer.from(payloadPart, 'base64url').toString('utf8');
  } catch {
    return false;
  }
  if (!payload.includes('|')) return false;

  const expected = createHmac('sha256', secret())
    .update(payload)
    .digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const [tokenRoute, validUntil] = payload.split('|');
  if (tokenRoute !== route) return false;
  return Number(validUntil) > now;
}

/** Cookie name for a route's unlock token. Route characters are cookie-safe. */
export function unlockCookieName(route: string): string {
  return `corium_unlock_${route}`;
}

/** Parse a raw `Cookie` header into a name→value map (route handlers don't
 * have access to Next's `cookies()` API). */
export function parseCookieHeader(header: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) map.set(key, value);
  }
  return map;
}
