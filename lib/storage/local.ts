import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  isSafeShareId,
  isSafeStorageKey,
  storageKeyFor,
  storedNameFor,
} from '@/lib/storage/naming';
import {
  type IncomingFile,
  StorageError,
  type StorageFileRef,
  type StorageLocation,
  type StorageProvider,
} from '@/lib/storage/types';

/**
 * Local filesystem storage — the V1 default and still the default.
 *
 * Files live under one uploads root, one directory per share:
 *
 *     <root>/<shareId>/<nn>-<name>
 *
 * On a serverless host the writable area is ephemeral (`/tmp`), which is why
 * `CORIUM_UPLOADS_DIR` can point somewhere that survives restarts. R2 is the
 * answer for deployments where it cannot.
 */

/** The uploads root, read per call so tests — and a changed env — are seen. */
export function uploadsRoot(): string {
  return process.env.CORIUM_UPLOADS_DIR ?? path.join('/tmp', 'corium-uploads');
}

export async function ensureUploadsRoot(): Promise<void> {
  await mkdir(uploadsRoot(), { recursive: true });
}

/**
 * Resolve a stored relative path inside the uploads root. Returns `null`
 * when the path would escape the root (defense against path traversal in
 * the `storedPath` column).
 */
export function resolveStoredPath(relative: string): string | null {
  const root = path.resolve(uploadsRoot());
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return absolute;
}

export async function storedFileExists(relative: string): Promise<boolean> {
  const absolute = resolveStoredPath(relative);
  if (!absolute) return false;
  try {
    await stat(absolute);
    return true;
  } catch {
    return false;
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/** The directory one share owns — never built from an unvalidated id. */
function shareDirectory(shareId: string): string {
  if (!isSafeShareId(shareId)) {
    throw new StorageError(`Unsafe share id "${shareId}"`, {
      code: 'unsafe_share_id',
    });
  }
  return path.join(uploadsRoot(), shareId);
}

export class LocalStorageProvider implements StorageProvider {
  readonly type = 'LOCAL' as const;

  /**
   * Writes the files one after another. If any write fails, the partial share
   * is removed again: a half-written set would otherwise look complete to the
   * database but download as a broken archive.
   */
  async save(
    shareId: string,
    files: readonly IncomingFile[],
  ): Promise<StorageLocation[]> {
    const directory = shareDirectory(shareId);
    const locations: StorageLocation[] = [];

    try {
      await mkdir(directory, { recursive: true });
      for (const file of files) {
        const relative = storageKeyFor(
          shareId,
          storedNameFor(file.position, file.fileName),
        );
        const absolute = resolveStoredPath(relative);
        if (!absolute) {
          throw new StorageError(`Unsafe stored path "${relative}"`, {
            code: 'unsafe_stored_path',
          });
        }
        await writeFile(absolute, await file.bytes());
        locations.push({
          storedPath: relative,
          storageType: 'LOCAL',
          r2Key: null,
          r2Bucket: null,
        });
      }
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
      if (error instanceof StorageError) throw error;
      throw new StorageError(`Could not store the files of share ${shareId}`, {
        code: 'write_failed',
        cause: error,
      });
    }

    return locations;
  }

  async get(file: StorageFileRef): Promise<Uint8Array | null> {
    const absolute = this.absolutePath(file);
    try {
      return new Uint8Array(await readFile(absolute));
    } catch (error) {
      if (isMissing(error)) return null;
      throw new StorageError(`Could not read ${file.storedPath}`, {
        code: 'read_failed',
        cause: error,
      });
    }
  }

  async exists(file: StorageFileRef): Promise<boolean> {
    return storedFileExists(file.storedPath);
  }

  async delete(file: StorageFileRef): Promise<void> {
    const absolute = this.absolutePath(file);
    try {
      await rm(absolute, { force: true });
    } catch (error) {
      throw new StorageError(`Could not delete ${file.storedPath}`, {
        code: 'delete_failed',
        cause: error,
      });
    }
  }

  async deleteShare(shareId: string): Promise<void> {
    await rm(shareDirectory(shareId), { recursive: true, force: true });
  }

  /** The absolute path of a row, refusing anything that escapes the root. */
  private absolutePath(file: StorageFileRef): string {
    if (!isSafeStorageKey(file.storedPath)) {
      throw new StorageError(`Unsafe stored path "${file.storedPath}"`, {
        code: 'unsafe_stored_path',
      });
    }
    const absolute = resolveStoredPath(file.storedPath);
    if (!absolute) {
      throw new StorageError(`Stored path escapes the uploads root`, {
        code: 'unsafe_stored_path',
      });
    }
    return absolute;
  }
}

/** One shared instance — the provider is stateless. */
export const localStorageProvider = new LocalStorageProvider();
