'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Shows "Log in" or the signed-in user's name (linking to /profile).
 * A tiny client component fetching the session — keeps the root layout (and
 * the static homepage) free of server-side session lookups.
 */
export function AuthNav() {
  const [user, setUser] = useState<
    { name: string; email: string } | null | undefined
  >(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/get-session', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((session) => {
        if (!cancelled) setUser(session?.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (user === undefined) {
    return <span className="h-8 w-16" aria-hidden />;
  }

  return user ? (
    <Link
      href="/profile"
      className="text-sm text-sub transition-colors hover:text-fg"
    >
      {user.name || user.email}
    </Link>
  ) : (
    <Link
      href="/login"
      className="text-sm text-sub transition-colors hover:text-fg"
    >
      Log in
    </Link>
  );
}
