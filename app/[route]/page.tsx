import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { PinForm } from '@/components/share/PinForm';
import { ShareView } from '@/components/share/ShareView';
import { isShareExpired } from '@/lib/expire';
import { isValidUnlockToken, unlockCookieName } from '@/lib/pin';
import { prisma } from '@/lib/prisma';
import { ROUTE_REGEX } from '@/lib/route';

// Share data changes (new shares, lazy expiry) — never prerender this route.
export const dynamic = 'force-dynamic';

/**
 * /[route] — the public share page.
 *
 * Server Component doing all the authoritative checks:
 *   1. malformed route            → 404
 *   2. no share for this route    → 404
 *   3. share expired (flag OR     → expired panel (+ lazy isExpired update)
 *      past expiresAt — no cron)
 *   4. PIN-protected & locked     → PinForm client component
 *   5. otherwise                  → content (read-only Monaco / file card)
 */
export default async function SharePage({
  params,
}: {
  params: Promise<{ route: string }>;
}) {
  const { route } = await params;
  if (!ROUTE_REGEX.test(route)) {
    notFound();
  }

  const now = new Date();
  const share = await prisma.share.findFirst({
    where: { route },
    orderBy: { createdAt: 'desc' },
    include: { files: { orderBy: { position: 'asc' } } },
  });
  if (!share) {
    notFound();
  }

  // Double-check expiry: isExpired flag OR past timestamp (lazy expiration —
  // V1 has no cron, so this also flips the flag opportunistically).
  if (isShareExpired(share, now)) {
    if (!share.isExpired) {
      await prisma.share
        .update({ where: { id: share.id }, data: { isExpired: true } })
        .catch(() => {});
    }
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-7 w-7"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" strokeLinecap="round" />
          </svg>
        </span>
        <h1 className="mt-5 text-xl font-semibold">This share has expired</h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-sub">
          <span className="font-mono text-fg">/{route}</span> was shared 24
          hours ago and self-destructed, as promised. Nothing was kept —
          that&rsquo;s the deal.
        </p>
      </div>
    );
  }

  // PIN gate: needs the author-set pinHash AND no valid unlock cookie.
  if (share.pinHash) {
    const store = await cookies();
    const token = store.get(unlockCookieName(route))?.value;
    const unlocked = Boolean(
      token && isValidUnlockToken(token, route, now.getTime()),
    );
    if (!unlocked) {
      return (
        <PinForm
          shareId={share.id}
          route={share.route}
          expiresAt={share.expiresAt.toISOString()}
        />
      );
    }
  }

  return (
    <ShareView
      route={share.route}
      type={share.type}
      content={share.content ?? ''}
      createdAt={share.createdAt.toISOString()}
      expiresAt={share.expiresAt.toISOString()}
      files={share.files.map((file) => ({
        id: file.id,
        fileName: file.fileName,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
      }))}
    />
  );
}
