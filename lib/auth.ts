import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { headers } from 'next/headers';

import { prisma } from './prisma';

/**
 * Better Auth — optional login (email + password).
 *
 * Everything else in the app works anonymously; signing in only attaches
 * `userId` to the shares you create and unlocks the profile page.
 */
export const auth = betterAuth({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
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
