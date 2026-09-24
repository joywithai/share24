import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';

/**
 * Protects /profile — the only gated route. Everything else (homepage,
 * create pages, share pages, login) is open to anonymous visitors.
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
  matcher: ['/profile/:path*'],
  runtime: 'nodejs',
};
