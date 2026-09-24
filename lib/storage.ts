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
