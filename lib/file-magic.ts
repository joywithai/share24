import { BLOCKED_FILE_MESSAGE, extensionOf } from '@/lib/file';

/**
 * What the bytes actually are.
 *
 * Every upload already passes the extension/MIME rules in `lib/file.ts`, but
 * those look at *names* and *claims* — both of which the uploader controls. A
 * `.txt` is a text file only if its contents say so. This module reads the
 * first bytes of a file and compares them against what the name and the
 * browser promised, which is what stops:
 *
 *   - a renamed archive or executable (`report.zip` → `report.txt`),
 *   - a file whose declared image type is a lie (`image/png` that is HTML),
 *   - content that is not the image its extension claims.
 *
 * The rule is "the name and the contents must agree": a `.png` that is really
 * a JPEG is refused with the same message, because the download header would
 * otherwise promise the wrong format. A PNG called `notes.txt` is a different
 * case — it is served and stored as `text/plain`, so it stays allowed.
 */

/** How much of a file we look at. */
export const SNIFF_BYTES = 8 * 1024;

export type SniffedKind =
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'pdf'
  | 'zip'
  | 'gzip'
  | '7z'
  | 'rar'
  | 'bzip2'
  | 'xz'
  | 'elf'
  | 'mz'
  | 'class'
  | 'sqlite'
  | 'html'
  | 'svg'
  | 'text'
  | 'unknown';

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/** Printable ASCII/UTF-8 text without NUL bytes in the sample. */
function looksTextual(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  let printable = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte === 9 || byte === 10 || byte === 13 || byte >= 32) printable += 1;
  }
  return sample.length > 0 && printable / sample.length > 0.9;
}

function decodeAscii(bytes: Uint8Array, length: number): string {
  const slice = bytes.subarray(0, Math.min(bytes.length, length));
  return String.fromCharCode(...slice).toLowerCase();
}

export function sniffBytes(bytes: Uint8Array): SniffedKind {
  if (bytes.length === 0) return 'unknown';

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    decodeAscii(bytes, 12).includes('webp')
  ) {
    return 'webp';
  }
  if (decodeAscii(bytes, 1024).includes('%pdf-')) return 'pdf';
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
  ) {
    return 'zip';
  }
  if (startsWith(bytes, [0x1f, 0x8b])) return 'gzip';
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf])) return '7z';
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21])) return 'rar';
  if (startsWith(bytes, [0x42, 0x5a, 0x68])) return 'bzip2';
  if (startsWith(bytes, [0xfd, 0x37, 0x7a, 0x58, 0x5a])) return 'xz';
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return 'elf';
  if (startsWith(bytes, [0x4d, 0x5a])) return 'mz';
  if (startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe])) return 'class';
  if (decodeAscii(bytes, 16).startsWith('sqlite format 3')) return 'sqlite';

  if (looksTextual(bytes)) {
    const text = decodeAscii(bytes, 2048).trimStart();
    if (
      text.startsWith('<!doctype html') ||
      text.startsWith('<html') ||
      text.startsWith('<head') ||
      text.startsWith('<body') ||
      text.includes('<script')
    ) {
      return 'html';
    }
    // An XML declaration plus an <svg> root is an SVG whatever it is called.
    if (text.includes('<svg') && text.startsWith('<')) return 'svg';
    return 'text';
  }

  return 'unknown';
}

/** Kinds that are never shareable, whatever the file claims to be. */
const BLOCKED_KINDS: Partial<Record<SniffedKind, string>> = {
  zip: 'an archive',
  gzip: 'an archive',
  '7z': 'an archive',
  rar: 'an archive',
  bzip2: 'an archive',
  xz: 'an archive',
  elf: 'an executable',
  mz: 'an executable',
  class: 'a Java class file',
};

/** What each image extension must look like inside. */
const IMAGE_KINDS = ['png', 'jpeg', 'gif', 'webp'] as const;
type ImageKind = (typeof IMAGE_KINDS)[number];

const EXTENSION_IMAGE: Record<string, ImageKind> = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  gif: 'gif',
  webp: 'webp',
};

export const MISMATCH_MESSAGE =
  "That file's contents don't match its name or type — upload the original file again.";

/**
 * Returns a human-readable problem when the bytes contradict the name/MIME,
 * or `null` when the file may be stored.
 */
export function bytesProblem(
  file: { name: string; type: string },
  bytes: Uint8Array,
): string | null {
  const kind = sniffBytes(bytes);
  const blocked = BLOCKED_KINDS[kind];
  if (blocked) return `${file.name} is ${blocked}. ${BLOCKED_FILE_MESSAGE}`;

  const declared = (file.type || '').toLowerCase();
  const extension = extensionOf(file.name);
  const expectedImage =
    (extension ? EXTENSION_IMAGE[extension] : undefined) ??
    (declared.startsWith('image/')
      ? (IMAGE_KINDS.find((candidate) => declared.includes(candidate)) as
          | ImageKind
          | undefined)
      : undefined);

  if (expectedImage) {
    // The extension/type promises an image; the bytes must be that image.
    if (!IMAGE_KINDS.includes(kind as ImageKind)) return MISMATCH_MESSAGE;
    if (kind !== expectedImage && extension) return MISMATCH_MESSAGE;
  }

  if (extension === 'pdf' && kind !== 'pdf') return MISMATCH_MESSAGE;
  if ((extension === 'html' || extension === 'htm') && kind !== 'html') {
    // Harmless (already blocked by extension), kept for clarity.
    return BLOCKED_FILE_MESSAGE;
  }

  return null;
}
