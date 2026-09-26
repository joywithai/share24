import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/auth/AuthForm';
import { getSession } from '@/lib/auth';

export const metadata: Metadata = { title: 'Log in' };

export const dynamic = 'force-dynamic';

/**
 * /login — optional auth entry point. Already signed in? Straight to
 * /profile. The form itself is a client component that talks to the Better
 * Auth REST endpoints under /api/auth.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getSession();
  if (session?.user) {
    redirect('/profile');
  }

  const { next } = await searchParams;
  const target =
    next?.startsWith('/') && !next.startsWith('//') ? next : '/profile';

  return <AuthForm redirectTarget={target} />;
}
