import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { headers } from 'next/headers';

import { prisma } from './prisma';

/** The public URL of the app — set it in production (e.g. Vercel + domain). */
const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || undefined;

/** Extra accepted origins, comma-separated (optional, any environment). */
const extraTrustedOrigins = (process.env.CORIUM_TRUSTED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Both schemes of the host a request actually arrived on.
 *
 * When `NEXT_PUBLIC_APP_URL` is unset Better Auth derives its base URL from
 * the incoming request — but that yields a single scheme, and a
 * TLS-terminating proxy (sandbox previews, Vercel) forwards plain `http://`
 * to the app while the browser sends `Origin: https://<public-host>`. Every
 * sign-in then fails the CSRF check with `403 Invalid origin`.
 *
 * Trusting both schemes of the request's own host fixes that without opening a
 * hole: a browser cannot set `Host`/`X-Forwarded-Host` from JavaScript, so an
 * attacker's page still can't produce a matching `Origin`. (A wildcard
 * `allowedHosts`/`trustedOrigins` entry would — hence none here.)
 */
function requestOrigins(request?: Request): string[] {
  if (!request) return [];
  const hosts = new Set<string>();
  for (const header of ['x-forwarded-host', 'host']) {
    // `x-forwarded-host` may be a comma-separated chain; the client's host is
    // the first entry.
    const value = request.headers.get(header)?.split(',')[0]?.trim();
    if (value) hosts.add(value);
  }
  return [...hosts].flatMap((host) => [`https://${host}`, `http://${host}`]);
}

/**
 * Better Auth — optional login (email + password).
 *
 * Everything else in the app works anonymously; signing in only attaches
 * `userId` to the shares you create and unlocks the profile page.
 */
export const auth = betterAuth({
  // Fixed in production; derived per request otherwise (see requestOrigins).
  baseURL: appUrl,
  // In production (`baseURL` set) only the explicitly listed extra origins are
  // accepted on top of it; locally/preview the request's own host is used.
  trustedOrigins: appUrl
    ? extraTrustedOrigins
    : (request) => [...requestOrigins(request), ...extraTrustedOrigins],
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    // V1 has no email-sending infrastructure — users can log in right away.
    requireEmailVerification: false,
  },
});

/**
 * Fetch the current session inside Server Components and Server Actions.
 * Returns `{ user, session }` or `null` when the request is anonymous.
 */
export async function getSession() {
  const headerList = await headers();
  return auth.api.getSession({ headers: headerList });
}
