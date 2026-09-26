import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Local filesystem storage (V1).
 *
 * Files are stored under a single uploads root, one directory per share:
 *   <root>/<shareId>/<storedFileName>
 *
 * On Vercel the writable area is `/tmp` (ephemeral — files disappear on
 * cold starts; a known V1 limitation, S3/R2 comes in V2).
 */

export const UPLOADS_ROOT =
  process.env.CORIUM_UPLOADS_DIR ?? path.join('/tmp', 'corium-uploads');

export async function ensureUploadsRoot(): Promise<void> {
  await mkdir(UPLOADS_ROOT, { recursive: true });
}

/**
 * Resolve a stored relative path inside the uploads root. Returns `null`
 * when the path would escape the root (defense against path traversal in
 * the `fileUrl` column).
 */
export function resolveStoredPath(relative: string): string | null {
  const root = path.resolve(UPLOADS_ROOT);
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return absolute;
}

/**
 * The entries whose bytes are still on disk, in the order they were given.
 *
 * This fails the other way round from an expired share: the metadata is in the
 * database while the disk (a wiped container, a `/tmp` uploads root) is empty.
 * Checking before answering a download means a visitor gets an explained page
 * instead of a 0-byte archive — or a corrupt one.
 */
export async function keepAvailable<T extends { storedPath: string }>(
  entries: T[],
  exists: (relative: string) => Promise<boolean> = storedFileExists,
): Promise<T[]> {
  const present = await Promise.all(
    entries.map((entry) => exists(entry.storedPath)),
  );
  return entries.filter((_, index) => present[index]);
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
