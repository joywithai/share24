import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { prisma } from '@/lib/prisma';
import { availableFiles, resolveStoredPath, uploadsRoot } from '@/lib/storage';

/**
 * The numbers behind the dashboard.
 *
 * Every query here is read-only and bounded: counts, group-bys and a couple of
 * short "latest N" lists — a dashboard that gets slower as the app grows would
 * defeat its own purpose.
 */

export interface DashboardStats {
  shares: {
    active: number;
    expired: number;
    total: number;
    createdToday: number;
  };
  files: { count: number; bytes: number; local: number; r2: number };
  users: { total: number; admins: number; suspended: number };
  security: {
    events24h: number;
    blocked: number;
    rateLimited24h: number;
    pinFailures24h: number;
  };
  expiringSoon: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function dashboardStats(
  now = new Date(),
): Promise<DashboardStats> {
  const since24h = new Date(now.getTime() - DAY_MS);
  const startOfToday = new Date(now.getTime() - (now.getTime() % DAY_MS));
  const in6h = new Date(now.getTime() + 6 * 60 * 60 * 1000);

  const [
    activeShares,
    expiredShares,
    sharesToday,
    totalShares,
    fileAggregate,
    localFiles,
    r2Files,
    userTotal,
    adminTotal,
    suspendedTotal,
    events24h,
    blockedTotal,
    rateLimited,
    pinFailures,
    expiringSoon,
  ] = await Promise.all([
    prisma.share.count({ where: { isExpired: false, expiresAt: { gt: now } } }),
    prisma.share.count({
      where: { OR: [{ isExpired: true }, { expiresAt: { lte: now } }] },
    }),
    prisma.share.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.share.count(),
    prisma.shareFile.aggregate({
      _count: { _all: true },
      _sum: { fileSize: true },
    }),
    prisma.shareFile.count({ where: { storageType: 'LOCAL' } }),
    prisma.shareFile.count({ where: { storageType: 'R2' } }),
    prisma.user.count(),
    prisma.user.count({ where: { role: 'admin' } }),
    prisma.user.count({ where: { status: 'suspended' } }),
    prisma.securityEvent.count({ where: { createdAt: { gte: since24h } } }),
    prisma.blockedIp.count(),
    prisma.securityEvent.count({
      where: { type: 'rate_limit', createdAt: { gte: since24h } },
    }),
    prisma.securityEvent.count({
      where: { type: 'pin_failure', createdAt: { gte: since24h } },
    }),
    prisma.share.count({
      where: { isExpired: false, expiresAt: { gt: now, lte: in6h } },
    }),
  ]);

  return {
    shares: {
      active: activeShares,
      expired: expiredShares,
      total: totalShares,
      createdToday: sharesToday,
    },
    files: {
      count: fileAggregate._count._all,
      bytes: fileAggregate._sum.fileSize ?? 0,
      local: localFiles,
      r2: r2Files,
    },
    users: { total: userTotal, admins: adminTotal, suspended: suspendedTotal },
    security: {
      events24h,
      blocked: blockedTotal,
      rateLimited24h: rateLimited,
      pinFailures24h: pinFailures,
    },
    expiringSoon,
  };
}

export interface DailyCount {
  /** `YYYY-MM-DD` (UTC) — the day bucket. */
  day: string;
  count: number;
}

/**
 * Counts per day for the last `days` days, gaps filled with zeroes so a chart
 * never has to guess where the quiet days went.
 */
export async function dailySeries(
  kind: 'shares' | 'events',
  days = 14,
  now = new Date(),
): Promise<DailyCount[]> {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      (days - 1) * DAY_MS,
  );

  const rows =
    kind === 'shares'
      ? await prisma.share.findMany({
          where: { createdAt: { gte: start } },
          select: { createdAt: true },
        })
      : await prisma.securityEvent.findMany({
          where: { createdAt: { gte: start } },
          select: { createdAt: true },
        });

  const buckets = new Map<string, number>();
  for (let index = 0; index < days; index += 1) {
    const day = new Date(start.getTime() + index * DAY_MS)
      .toISOString()
      .slice(0, 10);
    buckets.set(day, 0);
  }
  for (const row of rows) {
    const day = row.createdAt.toISOString().slice(0, 10);
    const current = buckets.get(day);
    if (current !== undefined) buckets.set(day, current + 1);
  }

  return [...buckets.entries()].map(([day, count]) => ({ day, count }));
}

export interface RecentShare {
  id: string;
  route: string;
  type: string;
  files: number;
  sizeBytes: number;
  expiresAt: Date;
  isExpired: boolean;
  hasPin: boolean;
  author: string | null;
  createdAt: Date;
}

export async function recentShares(limit = 8): Promise<RecentShare[]> {
  const shares = await prisma.share.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      route: true,
      type: true,
      expiresAt: true,
      isExpired: true,
      pinHash: true,
      createdAt: true,
      user: { select: { email: true } },
      files: { select: { fileSize: true } },
    },
  });

  return shares.map((share) => ({
    id: share.id,
    route: share.route,
    type: share.type,
    files: share.files.length,
    sizeBytes: share.files.reduce((sum, file) => sum + file.fileSize, 0),
    expiresAt: share.expiresAt,
    isExpired: share.isExpired,
    hasPin: Boolean(share.pinHash),
    author: share.user?.email ?? null,
    createdAt: share.createdAt,
  }));
}

export interface StorageBreakdown {
  storageType: string;
  files: number;
  bytes: number;
}

/** File counts/bytes per storage provider — for the storage page. */
export async function storageBreakdown(): Promise<StorageBreakdown[]> {
  const rows = await prisma.shareFile.groupBy({
    by: ['storageType'],
    _count: { _all: true },
    _sum: { fileSize: true },
  });

  return rows.map((row) => ({
    storageType: row.storageType,
    files: row._count._all,
    bytes: row._sum.fileSize ?? 0,
  }));
}

export interface OrphanScan {
  /** How many rows were checked (the newest ones). */
  checked: number;
  /** Rows whose bytes the storage provider cannot find. */
  missing: {
    id: string;
    shareId: string;
    fileName: string;
    storedPath: string;
    storageType: string;
  }[];
  /** Files on the disk that no share owns (local storage only). */
  strayFiles: { path: string; bytes: number }[];
}

/**
 * Is the database still describing real files?
 *
 * Two directions matter and both are cheap enough to run on demand:
 *   - rows whose bytes are gone (a wiped volume, a deleted bucket object),
 *   - bytes nobody claims (a share row deleted while its files stayed).
 */
export async function orphanScan(limit = 500): Promise<OrphanScan> {
  const rows = await prisma.shareFile.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      shareId: true,
      fileName: true,
      storedPath: true,
      storageType: true,
      r2Key: true,
      r2Bucket: true,
    },
  });

  const present = new Set((await availableFiles(rows)).map((row) => row.id));
  const missing = rows
    .filter((row) => !present.has(row.id))
    .map((row) => ({
      id: row.id,
      shareId: row.shareId,
      fileName: row.fileName,
      storedPath: row.storedPath,
      storageType: row.storageType,
    }));

  return {
    checked: rows.length,
    missing,
    strayFiles: await scanStrayFiles(rows),
  };
}

/** Local files under the uploads root that no `ShareFile` row points at. */
async function scanStrayFiles(
  rows: readonly { storedPath: string }[],
): Promise<{ path: string; bytes: number }[]> {
  const known = new Set(rows.map((row) => row.storedPath));
  const stray: { path: string; bytes: number }[] = [];
  const root = uploadsRoot();

  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return stray;
  }

  for (const shareId of entries.slice(0, 200)) {
    const directory = resolveStoredPath(shareId);
    if (!directory) continue;
    let files: string[] = [];
    try {
      const stats = await stat(directory);
      if (!stats.isDirectory()) continue;
      files = await readdir(directory);
    } catch {
      continue;
    }
    for (const file of files.slice(0, 200)) {
      const relative = `${shareId}/${file}`;
      if (known.has(relative)) continue;
      try {
        const info = await stat(path.join(directory, file));
        stray.push({ path: relative, bytes: info.size });
      } catch {
        // Vanished between listing and stat — nothing to report.
      }
    }
  }

  return stray.slice(0, 100);
}
