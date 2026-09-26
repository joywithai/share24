import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { prisma } from '@/lib/prisma';
import { logSecurityEvent, sweepExpiredBlocks } from '@/lib/security/events';
import { getSetting, maintenanceState } from '@/lib/settings';
import {
  isSafeShareId,
  providerFor,
  resolveStoredPath,
  uploadsRoot,
} from '@/lib/storage';

/**
 * The housekeeping job.
 *
 * V1 had no cron at all: an expired share stopped working because every read
 * checks `expiresAt`, but its rows and its bytes stayed forever. This is the
 * one job that actually removes things, and it is written to be safe to run at
 * any time, from anywhere, as often as anybody likes — every step is
 * idempotent and bounded, and a failure in one step does not stop the others.
 *
 * What it does, in order:
 *   1. expired shares older than the retention window → bytes, rows, gone
 *   2. rows whose bytes are missing and whose share is expired → row removed
 *   3. unclaimed files on the local disk → removed (never a live share's file)
 *   4. expired IP blocks → removed
 *   5. security events older than 30 days → removed
 */

export interface CleanupReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  trigger: 'cron' | 'admin' | 'startup';
  enabled: boolean;
  sharesDeleted: number;
  filesDeleted: number;
  bytesDeleted: number;
  orphanRowsDeleted: number;
  strayFilesDeleted: number;
  strayBytesDeleted: number;
  blocksDeleted: number;
  eventsDeleted: number;
  errors: string[];
}

/** How long security events are kept. */
const EVENT_RETENTION_DAYS = 30;

/** Never remove more than this in one run — a runaway job is worse than a slow one. */
const MAX_SHARES_PER_RUN = 500;
const MAX_FILES_PER_SHARE = 100;

export async function runCleanup(
  trigger: CleanupReport['trigger'] = 'cron',
): Promise<CleanupReport> {
  const startedAt = new Date();
  const report: CleanupReport = {
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    durationMs: 0,
    trigger,
    enabled: true,
    sharesDeleted: 0,
    filesDeleted: 0,
    bytesDeleted: 0,
    orphanRowsDeleted: 0,
    strayFilesDeleted: 0,
    strayBytesDeleted: 0,
    blocksDeleted: 0,
    eventsDeleted: 0,
    errors: [],
  };

  // A manual run from the panel always goes ahead; the scheduled one obeys the
  // switch, so an operator can pause it while investigating something.
  const enabled = await getSetting('cleanup_enabled');
  if (enabled !== 'on' && trigger === 'cron') {
    report.enabled = false;
    report.finishedAt = new Date().toISOString();
    return report;
  }

  const retentionHours = Number(
    await getSetting('expired_share_retention_hours'),
  );
  const cutoff = new Date(
    Date.now() -
      (Number.isFinite(retentionHours) ? retentionHours : 24) * 3600_000,
  );

  await step(report, 'expired shares', async () => {
    const expired = await prisma.share.findMany({
      where: {
        OR: [{ isExpired: true }, { expiresAt: { lte: new Date() } }],
        expiresAt: { lte: cutoff },
      },
      orderBy: { expiresAt: 'asc' },
      take: MAX_SHARES_PER_RUN,
      select: {
        id: true,
        route: true,
        files: {
          take: MAX_FILES_PER_SHARE,
          select: {
            id: true,
            fileSize: true,
            storedPath: true,
            storageType: true,
            r2Key: true,
            r2Bucket: true,
          },
        },
      },
    });

    for (const share of expired) {
      // Bytes first: deleting the row first would leave files nothing points
      // at, and the next run could not tell whose they were.
      for (const file of share.files) {
        try {
          await providerFor(file).delete(file);
          report.filesDeleted += 1;
          report.bytesDeleted += file.fileSize;
        } catch (error) {
          report.errors.push(`delete ${file.storedPath}: ${String(error)}`);
        }
      }
      try {
        // Local shares keep a folder per share; remove whatever is left in it.
        await providerFor(
          share.files[0] ?? {
            storedPath: '',
            storageType: 'LOCAL',
            r2Key: null,
            r2Bucket: null,
          },
        ).deleteShare(share.id);
      } catch (error) {
        report.errors.push(`delete share ${share.id}: ${String(error)}`);
      }
      try {
        await prisma.share.delete({ where: { id: share.id } });
        report.sharesDeleted += 1;
      } catch (error) {
        report.errors.push(`delete row ${share.id}: ${String(error)}`);
      }
    }
  });

  await step(report, 'orphan rows', async () => {
    const candidates = await prisma.shareFile.findMany({
      where: {
        createdAt: { lte: cutoff },
        share: {
          OR: [{ isExpired: true }, { expiresAt: { lte: new Date() } }],
        },
      },
      take: 500,
      select: {
        id: true,
        storedPath: true,
        storageType: true,
        r2Key: true,
        r2Bucket: true,
        shareId: true,
      },
    });

    for (const row of candidates) {
      let exists = true;
      try {
        exists = await providerFor(row).exists(row);
      } catch {
        // Unreachable storage is not proof that the bytes are gone.
        continue;
      }
      if (exists) continue;
      try {
        await prisma.shareFile.delete({ where: { id: row.id } });
        report.orphanRowsDeleted += 1;
      } catch (error) {
        report.errors.push(`orphan row ${row.id}: ${String(error)}`);
      }
    }
  });

  await step(report, 'stray files', async () => {
    const stray = await findStrayFiles(cutoff);
    for (const entry of stray) {
      const absolute = resolveStoredPath(entry.path);
      if (!absolute) continue;
      try {
        await rm(absolute, { force: true });
        report.strayFilesDeleted += 1;
        report.strayBytesDeleted += entry.bytes;
      } catch (error) {
        report.errors.push(`stray ${entry.path}: ${String(error)}`);
      }
    }
  });

  await step(report, 'expired blocks', async () => {
    report.blocksDeleted = await sweepExpiredBlocks();
  });

  await step(report, 'old events', async () => {
    const { count } = await prisma.securityEvent.deleteMany({
      where: {
        createdAt: {
          lt: new Date(Date.now() - EVENT_RETENTION_DAYS * 86_400_000),
        },
      },
    });
    report.eventsDeleted = count;
  });

  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - startedAt.getTime();

  await logSecurityEvent({
    type: 'maintenance',
    severity: report.errors.length > 0 ? 'warning' : 'info',
    detail:
      `cleanup (${trigger}): ${report.sharesDeleted} shares, ${report.filesDeleted} files, ` +
      `${report.strayFilesDeleted} stray files, ${report.blocksDeleted} blocks removed` +
      (report.errors.length > 0 ? ` — ${report.errors.length} error(s)` : ''),
  });

  return report;
}

/** Runs one step; a step that throws is recorded, not fatal. */
async function step(
  report: CleanupReport,
  name: string,
  work: () => Promise<void>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    report.errors.push(`${name}: ${String(error)}`);
  }
}

/**
 * Files under the uploads root that no `ShareFile` row claims, older than the
 * retention cutoff.
 *
 * Two things make this safe: only paths that came from a real directory
 * listing are considered (never user input), and the age check means a file
 * that was just written by a share creation in flight is never a candidate.
 */
export async function findStrayFiles(
  olderThan: Date,
): Promise<{ path: string; bytes: number }[]> {
  const known = new Set(
    (
      await prisma.shareFile.findMany({
        select: { storedPath: true },
        take: 20_000,
      })
    ).map((row) => row.storedPath),
  );

  const root = uploadsRoot();
  const stray: { path: string; bytes: number }[] = [];

  let directories: string[] = [];
  try {
    directories = await readdir(root);
  } catch {
    return stray;
  }

  for (const directory of directories) {
    if (!isSafeShareId(directory)) continue;
    const absoluteDirectory = path.join(root, directory);
    let files: string[] = [];
    try {
      if (!(await stat(absoluteDirectory)).isDirectory()) continue;
      files = await readdir(absoluteDirectory);
    } catch {
      continue;
    }

    for (const file of files) {
      const relative = `${directory}/${file}`;
      if (known.has(relative)) continue;
      try {
        const info = await stat(path.join(absoluteDirectory, file));
        if (info.mtime > olderThan) continue;
        stray.push({ path: relative, bytes: info.size });
      } catch {
        // Gone between listing and stat.
      }
    }
  }

  return stray;
}

/**
 * Maintenance mode is a *setting*, but the answer is needed on every write, so
 * it is read through the cached helper.
 */
export async function maintenanceBlocked(requester: {
  isAdmin: boolean;
}): Promise<{ blocked: boolean; message: string }> {
  const state = await maintenanceState();
  return {
    blocked: state.active && !requester.isAdmin,
    message: state.message,
  };
}
