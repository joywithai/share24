import { extensionOf } from '@/lib/file';

/**
 * How stored bytes are named — one rule for every provider, so a file that
 * was uploaded locally and one that was uploaded to R2 are recognisable in
 * exactly the same way:
 *
 *     <shareId>/<nn>-<sanitized name>
 *
 * The share id keeps shares apart, the position keeps the author's order, and
 * the sanitized name keeps the suffix (a `.pdf` stays a `.pdf`, which matters
 * for the MIME type a browser will pick when the file is opened).
 */

/** Keeps just the last path segment, strips anything a file system dislikes. */
export function sanitizeStoredBase(fileName: string): string {
  const last = fileName.split(/[\\/]/).pop() ?? '';
  return last
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 60);
}

/** `<nn>-<name>.<ext>` — the stored name of one file inside a share. */
export function storedNameFor(position: number, fileName: string): string {
  const base = sanitizeStoredBase(fileName);
  // The extension comes from the *sanitized* name: a device name like
  // `...hidden` must not turn into an odd `h.hidden` suffix.
  const ext = extensionOf(base);
  const stem = ext
    ? base.slice(0, Math.max(1, base.length - ext.length - 1))
    : base;
  return `${String(position + 1).padStart(2, '0')}-${stem || 'file'}${
    ext ? `.${ext}` : ''
  }`;
}

/** `<shareId>/<stored name>` — the folder (LOCAL) or object key (R2). */
export function storageKeyFor(shareId: string, storedName: string): string {
  return `${shareId}/${storedName}`;
}

/**
 * Share ids are uuids this app generates. Anything else — an id from a form,
 * a hand-written value — must never be used to build a path or a prefix.
 */
export function isSafeShareId(shareId: string): boolean {
  // No separators and no dots at all — so neither a path nor a bucket prefix
  // can be built out of something that was not an id.
  return /^[A-Za-z0-9-]{1,64}$/.test(shareId);
}

/** Object keys and relative paths must be relative, with no traversal. */
export function isSafeStorageKey(key: string): boolean {
  if (!key || key.startsWith('/') || key.includes('\\')) return false;
  return key
    .split('/')
    .every((part) => part.length > 0 && part !== '.' && part !== '..');
}
