import { prisma } from '@/lib/prisma';

/**
 * One box, four tables.
 *
 * An operator looking for "invoice" does not want to guess whether it is a
 * route, a file name, an email address or a line in the security log — so one
 * query searches all of them and the page groups the hits. Every part is
 * capped, because the point is to orient somebody, not to export the database.
 */

export interface SearchHit {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  badge?: string;
}

export interface SearchResults {
  query: string;
  shares: SearchHit[];
  files: SearchHit[];
  users: SearchHit[];
  events: SearchHit[];
  total: number;
}

const PER_GROUP = 8;

/** Escape the LIKE wildcards a user may have typed. */
function likeTerm(query: string): string {
  return query.replace(/[%_\\]/g, (match) => `\\${match}`);
}

export async function globalSearch(
  rawQuery: string,
  perGroup = PER_GROUP,
): Promise<SearchResults> {
  const query = rawQuery.trim().slice(0, 80);
  const results: SearchResults = {
    query,
    shares: [],
    files: [],
    users: [],
    events: [],
    total: 0,
  };
  if (query.length < 2) return results;

  const term = likeTerm(query);
  const contains = { contains: term, mode: 'insensitive' as const };

  const [shares, files, users, events] = await Promise.all([
    prisma.share.findMany({
      where: { route: contains },
      orderBy: { createdAt: 'desc' },
      take: perGroup,
      select: {
        id: true,
        route: true,
        type: true,
        isExpired: true,
        expiresAt: true,
        _count: { select: { files: true } },
      },
    }),
    prisma.shareFile.findMany({
      where: { fileName: contains },
      orderBy: { createdAt: 'desc' },
      take: perGroup,
      select: {
        id: true,
        fileName: true,
        fileSize: true,
        storageType: true,
        share: { select: { route: true } },
      },
    }),
    prisma.user.findMany({
      where: { OR: [{ email: contains }, { name: contains }] },
      orderBy: { createdAt: 'desc' },
      take: perGroup,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
      },
    }),
    prisma.securityEvent.findMany({
      where: {
        OR: [{ ip: contains }, { route: contains }, { detail: contains }],
      },
      orderBy: { createdAt: 'desc' },
      take: perGroup,
      select: { id: true, type: true, ip: true, route: true, detail: true },
    }),
  ]);

  // `take` already bounds these in SQL; slicing again keeps the page bounded
  // no matter what the database (or a test double) hands back.
  results.shares = shares.slice(0, perGroup).map((share) => ({
    id: share.id,
    title: `/${share.route}`,
    subtitle: `${share._count.files} file(s) · expires ${share.expiresAt
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ')}`,
    href: `/admin/shares?q=${encodeURIComponent(share.route)}`,
    badge:
      share.isExpired || share.expiresAt.getTime() <= Date.now()
        ? 'expired'
        : share.type,
  }));

  results.files = files.slice(0, perGroup).map((file) => ({
    id: file.id,
    title: file.fileName,
    subtitle: `in /${file.share.route} · ${file.storageType}`,
    href: `/admin/files?q=${encodeURIComponent(file.fileName)}`,
    badge: file.storageType === 'R2' ? 'R2' : 'local',
  }));

  results.users = users.slice(0, perGroup).map((user) => ({
    id: user.id,
    title: user.email,
    subtitle: user.name || 'no name',
    href: `/admin/users?q=${encodeURIComponent(user.email)}`,
    badge: user.role === 'admin' ? `admin · ${user.status}` : user.status,
  }));

  results.events = events.slice(0, perGroup).map((event) => ({
    id: event.id,
    title: event.type,
    subtitle: `${event.ip ?? 'unknown ip'}${event.route ? ` · /${event.route}` : ''}${
      event.detail ? ` · ${event.detail.slice(0, 80)}` : ''
    }`,
    href: `/admin/security?type=${encodeURIComponent(event.type)}`,
    badge: event.ip ?? undefined,
  }));

  results.total =
    results.shares.length +
    results.files.length +
    results.users.length +
    results.events.length;

  return results;
}
