import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { guardRequest } from '@/lib/security/guard';

/**
 * Protects /profile and the admin panel, and rate limits sign-in. Everything
 * else (homepage, create pages, share pages, login page) is open to anonymous
 * visitors.
 *
 * The check here is "is somebody signed in?" — enough to bounce an anonymous
 * visitor to the login page without a database read. The *authoritative*
 * answer for /admin (is this account an administrator?) is made in
 * `app/admin/layout.tsx`, where the role is read from the database and a wrong
 * answer renders a 404 rather than a redirect that would confirm the panel
 * exists.
 *
 * Runs in the Node.js runtime so it can resolve the session directly (the
 * Edge runtime cannot use the pg driver adapter).
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Sign-in attempts are rate limited (5 per 15 minutes per address) before
  // Better Auth ever sees them — a password guess is cheap to send and
  // expensive to hash. Reads are left alone: the session lookup must keep
  // working.
  if (pathname.startsWith('/api/auth')) {
    if (request.method !== 'POST') return NextResponse.next();
    const limited = await guardRequest(request, 'login', { route: pathname });
    return limited ?? NextResponse.next();
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/profile/:path*', '/admin/:path*', '/api/auth/:path*'],
  runtime: 'nodejs',
};
