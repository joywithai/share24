import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { downloadFailure } from '@/lib/download-error';
import {
  availableFiles,
  resolveStoredPath,
  type StorageFileRef,
} from '@/lib/storage';

interface FakeFile extends StorageFileRef {
  id: string;
}

function file(id: string): FakeFile {
  return {
    id,
    storedPath: `share/${id}.txt`,
    storageType: 'LOCAL',
    r2Key: null,
    r2Bucket: null,
  };
}

/** Writes real bytes under the throwaway root from tests/setup.ts. */
async function writeStored(relative: string, body: string): Promise<void> {
  const absolute = resolveStoredPath(relative);
  if (!absolute) throw new Error(`unsafe test path: ${relative}`);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, body);
}

describe('availableFiles', () => {
  it('keeps the entries that are still on disk, in the order given', async () => {
    await writeStored('share/a.txt', 'a');
    await writeStored('share/c.txt', 'c');

    const present = await availableFiles([file('a'), file('b'), file('c')]);

    expect(present.map((entry) => entry.id)).toEqual(['a', 'c']);
  });

  it('returns nothing when the whole folder was wiped', async () => {
    const present = await availableFiles([file('gone-for-good')]);
    expect(present).toEqual([]);
  });
});

describe('downloadFailure', () => {
  it('answers with a page, not a bare sentence', async () => {
    const response = downloadFailure('share-gone', { route: 'old-share' });

    expect(response.status).toBe(410);
    expect(response.headers.get('content-type')).toBe(
      'text/html; charset=utf-8',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');

    const html = await response.text();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('This link is gone');
    expect(html).toContain('/old-share');
    // Always a way forward: upload again, or go home.
    expect(html).toContain('href="/create/file"');
    expect(html).toContain('href="/"');
  });

  it('explains a wipe that left the share behind', async () => {
    const html = await downloadFailure('files-gone', {
      route: 'half-there',
      missing: 3,
    }).text();

    expect(html).toContain('These files are no longer on the server');
    expect(html).toContain('all 3 files were');
    expect(html).toContain('410 · /half-there');
  });

  it('uses the status that matches the problem', () => {
    expect(downloadFailure('not-part-of-share', { route: 'r' }).status).toBe(
      404,
    );
    expect(downloadFailure('corrupt', { route: 'r' }).status).toBe(500);
    expect(downloadFailure('file-gone', { route: 'r' }).status).toBe(410);
  });

  it('escapes whatever the route contains', async () => {
    const html = await downloadFailure('share-gone', {
      route: 'a<script>"x"',
    }).text();

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
