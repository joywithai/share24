/**
 * File upload rules (V1): a small allow-list of document/image types and a
 * 10 MB size cap (close to serverless request limits).
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Extension (lowercase, no dot) → canonical MIME type. */
export const ALLOWED_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** MIME types browsers report when they cannot guess the type — accepted. */
const GENERIC_MIME_TYPES = new Set(['', 'application/octet-stream']);

/** Lowercase extension without the dot, or `null`. */
export function extensionOf(name: string): string | null {
  // Take the basename first — never trust path-like upload names.
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Returns a human-readable problem description, or `null` when the file is
 * acceptable. Used by the client (instant feedback) and the server action
 * (authoritative check).
 */
export function fileProblem(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  const ext = extensionOf(file.name);
  if (!ext || !(ext in ALLOWED_EXTENSIONS)) {
    return 'Only PNG, JPG, WEBP, PDF, TXT, DOC and DOCX files are allowed.';
  }
  if (file.size === 0) {
    return 'That file is empty.';
  }
  if (file.size > MAX_FILE_BYTES) {
    return `Files must be ${MAX_FILE_BYTES / (1024 * 1024)} MB or smaller.`;
  }
  const expected = ALLOWED_EXTENSIONS[ext];
  if (
    file.type &&
    !GENERIC_MIME_TYPES.has(file.type) &&
    file.type !== expected
  ) {
    return 'The file type does not match its extension.';
  }
  return null;
}

/** Best-known MIME type for storage (extension wins, browser value is a fallback). */
export function mimeTypeFor(name: string, declared: string): string {
  const ext = extensionOf(name);
  if (ext && ext in ALLOWED_EXTENSIONS) return ALLOWED_EXTENSIONS[ext];
  return declared || 'application/octet-stream';
}

/** "1.2 MB", "340 KB" — human-readable byte sizes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let i = -1;
  do {
    value /= 1024;
    i += 1;
  } while (value >= 1024 && i < units.length - 1);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}
