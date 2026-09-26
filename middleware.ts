import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';

/**
 * Protects /profile and the admin panel. Everything else (homepage, create
 * pages, share pages, login) is open to anonymous visitors.
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

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/profile/:path*', '/admin/:path*'],
  runtime: 'nodejs',
};
