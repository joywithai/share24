import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  availableFiles,
  configuredStorageType,
  type IncomingFile,
  LocalStorageProvider,
  localStorageProvider,
  providerFor,
  resolveStoredPath,
  StorageConfigError,
  type StorageFileRef,
  storageKeyFor,
  storedNameFor,
} from '@/lib/storage';

/**
 * The local provider is the one every existing share uses, so these tests work
 * on real files in a throwaway uploads root rather than on a mock.
 */

let root: string;
const provider = new LocalStorageProvider();

function incoming(
  fileName: string,
  position: number,
  body: string,
  mimeType = 'text/plain',
): IncomingFile {
  return {
    fileName,
    position,
    mimeType,
    fileSize: Buffer.byteLength(body),
    bytes: async () => new Uint8Array(Buffer.from(body)),
  };
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'corium-storage-'));
  process.env.CORIUM_UPLOADS_DIR = root;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('stored names', () => {
  it('keeps the order prefix and the extension', () => {
    expect(storedNameFor(0, 'Report Final.pdf')).toBe('01-Report_Final.pdf');
    expect(storedNameFor(9, 'notes.txt')).toBe('10-notes.txt');
  });

  it('strips directories and traversal from the stored name', () => {
    expect(storedNameFor(0, '../../etc/passwd')).toBe('01-passwd');
    expect(storedNameFor(0, 'C:\\Users\\me\\photo.png')).toBe('01-photo.png');
    expect(storedNameFor(0, '...hidden')).toBe('01-hidden');
  });

  it('names a share folder as <shareId>/<stored name>', () => {
    expect(storageKeyFor('abc-123', '01-a.txt')).toBe('abc-123/01-a.txt');
  });
});

describe('LocalStorageProvider', () => {
  it('saves, reads, deletes and reports a share', async () => {
    const shareId = 'share-write-1';
    const locations = await provider.save(shareId, [
      incoming('hello.txt', 0, 'hi there'),
      incoming('second.md', 1, '# notes'),
    ]);

    expect(locations.map((entry) => entry.storedPath)).toEqual([
      'share-write-1/01-hello.txt',
      'share-write-1/02-second.md',
    ]);
    expect(locations.every((entry) => entry.storageType === 'LOCAL')).toBe(
      true,
    );
    expect(locations[0].r2Key).toBeNull();

    // The bytes really are on the disk, under the uploads root.
    expect(
      await readFile(path.join(root, 'share-write-1/01-hello.txt'), 'utf8'),
    ).toBe('hi there');

    const ref = refFor(locations[0].storedPath);
    expect(await provider.exists(ref)).toBe(true);
    const bytes = await provider.get(ref);
    expect(Buffer.from(bytes ?? []).toString('utf8')).toBe('hi there');

    await provider.delete(ref);
    expect(await provider.exists(ref)).toBe(false);
    expect(await provider.get(ref)).toBeNull();

    await provider.deleteShare(shareId);
    expect(await provider.exists(refFor(locations[1].storedPath))).toBe(false);
  });

  it('returns null instead of throwing for bytes that are gone', async () => {
    const missing = refFor('share-write-1/99-never-written.txt');
    expect(await provider.get(missing)).toBeNull();
    expect(await provider.exists(missing)).toBe(false);
    // Deleting something already gone is not an error either.
    await expect(provider.delete(missing)).resolves.toBeUndefined();
  });

  it('refuses to build a path outside the uploads root', async () => {
    expect(resolveStoredPath('../../etc/passwd')).toBeNull();
    await expect(provider.get(refFor('../outside.txt'))).rejects.toThrow(
      /unsafe|escap/i,
    );
    await expect(
      provider.save('../escape', [incoming('a.txt', 0, 'x')]),
    ).rejects.toThrow(/unsafe/i);
  });

  it('leaves nothing behind when one file of a set cannot be written', async () => {
    const shareId = 'share-write-partial';
    const files = [
      incoming('ok.txt', 0, 'fine'),
      {
        ...incoming('boom.txt', 1, ''),
        bytes: async () => {
          throw new Error('pickup failed');
        },
      },
    ];

    await expect(provider.save(shareId, files)).rejects.toThrow(
      /could not store/i,
    );
    expect(await provider.exists(refFor(`${shareId}/01-ok.txt`))).toBe(false);
  });
});

describe('availableFiles', () => {
  it('keeps the entries whose bytes are really there, in order', async () => {
    const shareId = 'share-available';
    await provider.save(shareId, [
      incoming('a.txt', 0, 'a'),
      incoming('b.txt', 1, 'b'),
      incoming('c.txt', 2, 'c'),
    ]);
    await provider.delete(refFor(`${shareId}/02-b.txt`));

    const present = await availableFiles([
      { ...refFor(`${shareId}/01-a.txt`), id: 'a' },
      { ...refFor(`${shareId}/02-b.txt`), id: 'b' },
      { ...refFor(`${shareId}/03-c.txt`), id: 'c' },
    ]);

    expect(present.map((entry) => entry.id)).toEqual(['a', 'c']);
  });

  it('reports a row whose storage is unreachable as not there', async () => {
    // An R2 row in an app with no R2 credentials must not explode the page.
    const present = await availableFiles([
      {
        storedPath: 'share-x/01-a.txt',
        storageType: 'R2',
        r2Key: 'share-x/01-a.txt',
        r2Bucket: 'bucket',
        id: 'r2-row',
      },
    ]);

    expect(present).toEqual([]);
  });
});

describe('provider selection', () => {
  it('defaults to LOCAL and reads STORAGE_TYPE when set', () => {
    expect(configuredStorageType({})).toBe('LOCAL');
    expect(configuredStorageType({ STORAGE_TYPE: 'r2' })).toBe('R2');
    expect(configuredStorageType({ STORAGE_TYPE: ' LOCAL ' })).toBe('LOCAL');
  });

  it('refuses a storage type it does not know', () => {
    expect(() => configuredStorageType({ STORAGE_TYPE: 'S3' })).toThrow(
      StorageConfigError,
    );
  });

  it('routes each file to the provider that owns it', () => {
    expect(providerFor(refFor('a/b.txt'))).toBe(localStorageProvider);
  });
});

/** A minimal local row for the provider under test. */
function refFor(storedPath: string): StorageFileRef {
  return { storedPath, storageType: 'LOCAL', r2Key: null, r2Bucket: null };
}

describe('storage config', () => {
  it('never needs R2 credentials while STORAGE_TYPE is LOCAL', async () => {
    const saved = {
      STORAGE_TYPE: process.env.STORAGE_TYPE,
      R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    };
    process.env.STORAGE_TYPE = 'LOCAL';
    delete process.env.R2_ACCOUNT_ID;

    expect(providerFor(refFor('a/b.txt'))).toBe(localStorageProvider);
    // And a local file is still readable with no R2 env at all.
    const shareId = 'share-no-r2-env';
    await provider.save(shareId, [incoming('a.txt', 0, 'still fine')]);
    const bytes = await provider.get(refFor(`${shareId}/01-a.txt`));
    expect(Buffer.from(bytes ?? []).toString('utf8')).toBe('still fine');

    if (saved.STORAGE_TYPE === undefined) delete process.env.STORAGE_TYPE;
    else process.env.STORAGE_TYPE = saved.STORAGE_TYPE;
    if (saved.R2_ACCOUNT_ID === undefined) delete process.env.R2_ACCOUNT_ID;
    else process.env.R2_ACCOUNT_ID = saved.R2_ACCOUNT_ID;
  });

  it('writes a file to the throwaway root from the test setup', async () => {
    await writeFile(path.join(root, '.keep'), '');
    expect(root.startsWith(tmpdir())).toBe(true);
  });
});
