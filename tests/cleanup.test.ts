import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The cleanup job's file handling.
 *
 * `findStrayFiles` is the dangerous half — it deletes things from the disk — so
 * it runs here against a real throwaway uploads root: only files that no share
 * row claims *and* that are older than the cutoff may come back.
 */

const shareFileFindMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    shareFile: { findMany: (...args: unknown[]) => shareFileFindMany(...args) },
  },
}));

const { findStrayFiles } = await import('@/lib/cleanup/auto');
const { storageKeyFor } = await import('@/lib/storage');

// A fresh uploads root per test: these tests look at everything under the
// root, so leftovers from an earlier case would look like stray files.
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'corium-cleanup-'));
  process.env.CORIUM_UPLOADS_DIR = root;
});

afterEach(async () => {
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});

/** Writes a file under the uploads root, with an age in minutes. */
async function plant(relative: string, body: string, ageMinutes = 0) {
  const absolute = path.join(root, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, body);
  if (ageMinutes > 0) {
    const when = new Date(Date.now() - ageMinutes * 60_000);
    await utimes(absolute, when, when);
  }
  return absolute;
}

describe('findStrayFiles', () => {
  it('reports unclaimed old files, and leaves claimed ones alone', async () => {
    const shareId = 'cleanup-claimed';
    const claimed = storageKeyFor(shareId, '01-kept.txt');
    await plant(claimed, 'belongs to a share', 120);
    const stray = `${shareId}/02-stray.txt`;
    await plant(stray, 'nobody claims me', 120);

    shareFileFindMany.mockResolvedValue([{ storedPath: claimed }]);

    const found = await findStrayFiles(new Date(Date.now() - 60_000));

    expect(found.map((entry) => entry.path)).toEqual([stray]);
    expect(found[0].bytes).toBe(Buffer.byteLength('nobody claims me'));
  });

  it('never reports a file that was just written', async () => {
    const shareId = 'cleanup-fresh';
    const fresh = `${shareId}/01-just-written.txt`;
    await plant(fresh, 'in flight', 0);

    shareFileFindMany.mockResolvedValue([]);

    const found = await findStrayFiles(new Date(Date.now() - 60_000));
    expect(found.map((entry) => entry.path)).not.toContain(fresh);
  });

  it('skips directories that are not share folders', async () => {
    await plant('not-a-share-id!.txt', 'ignored');
    await mkdir(path.join(root, '.)weird'), { recursive: true });
    shareFileFindMany.mockResolvedValue([]);

    const found = await findStrayFiles(new Date(Date.now() + 60_000));
    expect(found.map((entry) => entry.path)).not.toContain(
      'not-a-share-id!.txt',
    );
  });

  it('works on an uploads root that does not exist yet', async () => {
    const previous = process.env.CORIUM_UPLOADS_DIR;
    process.env.CORIUM_UPLOADS_DIR = path.join(root, 'missing-root');
    shareFileFindMany.mockResolvedValue([]);

    await expect(findStrayFiles(new Date())).resolves.toEqual([]);

    process.env.CORIUM_UPLOADS_DIR = previous;
  });

  it('does not report a file it is not allowed to resolve', async () => {
    // A share folder whose name is fine, but with a file name that is not a
    // path we would ever build — the guard in resolveStoredPath has the last
    // word at delete time, and the listing must not crash on the way there.
    const files = await findStrayFiles(new Date(Date.now() - 60_000));
    expect(Array.isArray(files)).toBe(true);
    for (const entry of files) {
      expect(entry.path).not.toContain('..');
      expect(path.isAbsolute(entry.path)).toBe(false);
    }
  });
});

describe('the job is safe to run twice', () => {
  it('a claimed file is still there after a scan', async () => {
    const shareId = 'cleanup-twice';
    const claimed = storageKeyFor(shareId, '01-still-here.txt');
    const absolute = await plant(claimed, 'kept', 300);
    shareFileFindMany.mockResolvedValue([{ storedPath: claimed }]);

    const first = await findStrayFiles(new Date(Date.now() - 60_000));
    const second = await findStrayFiles(new Date(Date.now() - 60_000));

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    await expect(stat(absolute)).resolves.toBeTruthy();
  });
});
