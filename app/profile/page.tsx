import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getSession } from '@/lib/auth';
import { isShareExpired } from '@/lib/expire';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Profile' };

export const dynamic = 'force-dynamic';

/**
 * /profile — Server Component (middleware already guarantees a session).
 * Lists the signed-in user's shares with live status (active/expired is
 * derived from `expiresAt`, so status stays correct without a cron).
 */
export default async function ProfilePage() {
  const session = await getSession();
  if (!session?.user) {
    redirect('/login');
  }

  const user = session.user;
  const shares = await prisma.share.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const now = new Date();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your shares</h1>
        <p className="mt-1 text-sm text-sub">
          {user.name || user.email} — everything below self-destructs 24 hours
          after creation.
        </p>
      </div>

      {shares.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No shares yet</CardTitle>
            <CardDescription>
              Create one and it will show up here with its live status.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/create/code"
              className={buttonVariants({ size: 'sm' })}
            >
              Share code
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-line p-0">
            {shares.map((share) => {
              const active = !isShareExpired(share, now);
              return (
                <div
                  key={share.id}
                  className="flex items-center justify-between gap-4 px-5 py-3.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/${share.route}`}
                        className="truncate font-mono text-sm text-accent hover:underline"
                      >
                        /{share.route}
                      </Link>
                      <Badge variant="neutral">{share.type}</Badge>
                      {share.pinHash && (
                        <Badge variant="neutral">
                          <svg
                            aria-hidden
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="h-3 w-3"
                          >
                            <rect x="5" y="11" width="14" height="9" rx="2" />
                            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                          </svg>
                          PIN
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-sub">
                      Created {share.createdAt.toLocaleString()} ·{' '}
                      {active
                        ? `expires ${share.expiresAt.toLocaleString()}`
                        : 'expired'}
                    </p>
                  </div>
                  <Badge variant={active ? 'success' : 'danger'}>
                    {active ? 'active' : 'expired'}
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
