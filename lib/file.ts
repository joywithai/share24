/**
 * File upload rules (V1.2): one share carries 1–10 files, each up to 10 MB
 * and 50 MB in total, except the kinds that can hurt the site or bloat it —
 * archives, executables, active web content and media containers. Text-ish
 * developer files (js, css, c++, md, json, …) are welcome.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file

/** How many files a single share may carry. */
export const MAX_FILES_PER_SHARE = 10;

/** Ceiling for one share's files combined (the whole set, not per file). */
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB per share

/** Well-known extension → canonical MIME type (storage hint only). */
export const KNOWN_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Backwards-friendly alias for the document/image map above. */
export const ALLOWED_EXTENSIONS = KNOWN_MIME_TYPES;

/** Extensions that are never shareable. */
export const BLOCKED_EXTENSIONS = new Set([
  // archives & disk images
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'bz2',
  'xz',
  'zst',
  'iso',
  'img',
  'dmg',
  // executables, libraries, installers, scripts-that-run
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'bat',
  'cmd',
  'com',
  'msi',
  'apk',
  'deb',
  'rpm',
  'jar',
  'class',
  'ps1',
  'psm1',
  'vbs',
  'scr',
  'cpl',
  // active web content (XSS vector if ever served back)
  'html',
  'htm',
  'xhtml',
  'shtml',
  'mhtml',
  'mht',
  'svg',
  'swf',
  // video & audio containers
  'mp4',
  'mkv',
  'avi',
  'mov',
  'wmv',
  'flv',
  'webm',
  'm4v',
  'mpg',
  'mpeg',
  '3gp',
  'mp3',
  'wav',
  'flac',
  'aac',
  'ogg',
  'm4a',
  'wma',
  'opus',
]);

/** MIME prefixes that are never shareable (catches odd extensions). */
const BLOCKED_MIME_PREFIXES = ['video/', 'audio/'];

/** Exact MIME types that are never shareable. */
const BLOCKED_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip',
  'application/x-bzip2',
  'application/x-xz',
  'application/x-iso9660-image',
  'application/vnd.microsoft.portable-executable',
  'application/x-msdownload',
  'application/x-dosexec',
  'application/x-shockwave-flash',
  'application/java-archive',
  'application/x-apple-diskimage',
  // active content: any document that could run script if ever rendered
  'text/html',
  'application/xhtml+xml',
  'application/xml',
  'text/xml',
  'image/svg+xml',
]);

/** Longest file name we keep (the display name, not the stored one). */
export const MAX_DISPLAY_NAME = 120;

/**
 * The name shown to the visitor and put in `Content-Disposition`.
 *
 * Device names can carry control characters and Unicode bidi overrides — the
 * classic trick is `invoice‮gnp.exe` rendering as `invoice exe.png`.
 * Bidi/format characters have no business in a file name, so they are dropped,
 * path separators collapse to `_`, and the result is trimmed to a sane length.
 */
export function sanitizeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = cleaned.length > 0 ? cleaned : 'file';
  if (safe.length <= MAX_DISPLAY_NAME) return safe;
  const ext = extensionOf(safe);
  if (!ext || ext.length + 1 >= MAX_DISPLAY_NAME) {
    return safe.slice(0, MAX_DISPLAY_NAME);
  }
  const stem = safe.slice(0, safe.length - ext.length - 1);
  return `${stem.slice(0, MAX_DISPLAY_NAME - ext.length - 1)}.${ext}`;
}

export const BLOCKED_FILE_MESSAGE =
  "That file type can't be shared — archives, executables, web pages and video/audio are blocked.";

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
  if (ext && BLOCKED_EXTENSIONS.has(ext)) return BLOCKED_FILE_MESSAGE;

  const mime = (file.type || '').toLowerCase();
  if (
    BLOCKED_MIME_TYPES.has(mime) ||
    BLOCKED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
  ) {
    return BLOCKED_FILE_MESSAGE;
  }

  if (file.size === 0) {
    return 'That file is empty.';
  }
  if (file.size > MAX_FILE_BYTES) {
    return `Files must be ${MAX_FILE_BYTES / (1024 * 1024)} MB or smaller.`;
  }
  return null;
}

/**
 * Validates a whole upload set for one share: at least one file, at most
 * `MAX_FILES_PER_SHARE`, every file acceptable on its own, and everything
 * together inside `MAX_TOTAL_BYTES`. Returns a message, or `null` when the
 * set may be shared. Used by the client (instant feedback) and by the server
 * action (authoritative).
 */
export function filesProblem(
  files: readonly { name: string; type: string; size: number }[],
): string | null {
  if (files.length === 0) return 'Choose at least one file to share.';
  if (files.length > MAX_FILES_PER_SHARE) {
    return `A share can hold ${MAX_FILES_PER_SHARE} files at most — remove ${files.length - MAX_FILES_PER_SHARE}.`;
  }

  for (const file of files) {
    const issue = fileProblem(file);
    if (issue) return `${file.name}: ${issue}`;
  }

  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    return `That set is ${formatBytes(total)} — a share can hold ${MAX_TOTAL_BYTES / (1024 * 1024)} MB in total.`;
  }
  return null;
}

/** Best-known MIME type for storage (extension wins, browser value is a fallback). */
export function mimeTypeFor(name: string, declared: string): string {
  const ext = extensionOf(name);
  if (ext && ext in KNOWN_MIME_TYPES) return KNOWN_MIME_TYPES[ext];
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
