import { readFile, stat } from 'node:fs/promises';
import { deflateRaw } from 'node:zlib';

/**
 * A tiny ZIP writer, streaming, no dependencies.
 *
 * "Download all" for a multi-file share needs a real archive; pulling in a zip
 * library for that would be a lot of surface for one button, and `node:zlib`
 * already has everything the format needs (deflate + CRC32). Entries are read
 * from disk one at a time and pushed out as they are compressed, so a 50 MB
 * share never has to sit in memory as a whole.
 *
 * Only the plain "deflate" path of the spec is implemented — no ZIP64, no
 * encryption, no data descriptors. 50 MB of files stays well inside the
 * classic 4 GB offsets, so nothing above is needed.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Where one entry's bytes come from. Local shares hand over a path (read one
 * file at a time as the archive streams); anything remote hands over a lazy
 * loader, so the provider is asked for the bytes while the archive is being
 * written instead of loading a whole share into memory first.
 */
export type ZipSource =
  | { kind: 'path'; path: string }
  | { kind: 'remote'; load: () => Promise<Uint8Array | null> };

export interface ZipEntry {
  /** Name inside the archive (path separators are stripped). */
  name: string;
  source: ZipSource;
}

/**
 * Thrown when a remote entry turns out to be gone *while* the archive is being
 * built. The caller filters missing files out before starting, so this is the
 * race that is left: the stream ends in an error rather than a corrupt archive.
 */
export class ZipSourceMissingError extends Error {
  constructor(readonly entryName: string) {
    super(`Zip entry "${entryName}" disappeared while the archive was built`);
    this.name = 'ZipSourceMissingError';
  }
}

/** Zip stores MS-DOS date/time: seconds are 2-second steps, years start 1980. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Keeps an archive entry name harmless: no directories, no traversal. */
export function safeEntryName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // Control characters (\p{Cc}) and the characters Windows forbids in a file
  // name are not allowed inside an archive entry.
  const cleaned = base.replace(/[\p{Cc}<>:"|?*]/gu, '_').trim();
  return cleaned.replace(/^\.+/, '') || 'file';
}

/** Duplicate names inside one archive get `-2`, `-3`, … appended. */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  while (taken.has(`${stem}-${n}${ext}`)) n += 1;
  const next = `${stem}-${n}${ext}`;
  taken.add(next);
  return next;
}

interface Written {
  name: Buffer;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
  time: number;
  date: number;
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

/** One entry's bytes, however they are stored. */
async function readEntry(
  source: ZipSource,
  entryName: string,
): Promise<Buffer> {
  if (source.kind === 'path') return readFile(source.path);
  const bytes = await source.load();
  if (!bytes) throw new ZipSourceMissingError(entryName);
  return Buffer.from(bytes);
}

/**
 * Builds the archive lazily — one entry per `next()` call — so the ReadableStream
 * below can hand the browser bytes while the remaining files are still on disk.
 */
async function* buildArchive(
  entries: readonly ZipEntry[],
): AsyncGenerator<Uint8Array> {
  const written: Written[] = [];
  const takenNames = new Set<string>();
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(
      uniqueName(safeEntryName(entry.name), takenNames),
      'utf8',
    );
    const data = await readEntry(entry.source, entry.name);
    const compressed = await new Promise<Buffer>((resolve, reject) => {
      deflateRaw(data, { level: 6 }, (error, result) =>
        error ? reject(error) : resolve(result),
      );
    });

    const modifiedAt =
      entry.source.kind === 'path'
        ? (await stat(entry.source.path)).mtime
        : new Date();
    const { time, date } = dosDateTime(modifiedAt);
    const crc = crc32(data);

    // Local file header: no data descriptor, so sizes and CRC go in up front.
    const header = Buffer.concat([
      u32(0x04034b50),
      u16(20), // version needed to extract
      u16(0x0800), // UTF-8 file names
      u16(8), // deflate
      u16(time),
      u16(date),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
    ]);

    yield header;
    yield compressed;
    offset += header.length + compressed.length;

    written.push({
      name,
      crc,
      compressedSize: compressed.length,
      uncompressedSize: data.length,
      offset: offset - header.length - compressed.length,
      time,
      date,
    });
  }

  const centralStart = offset;
  for (const entry of written) {
    const header = Buffer.concat([
      u32(0x02014b50),
      u16(20), // version made by
      u16(20), // version needed
      u16(0x0800),
      u16(8),
      u16(entry.time),
      u16(entry.date),
      u32(entry.crc),
      u32(entry.compressedSize),
      u32(entry.uncompressedSize),
      u16(entry.name.length),
      u16(0), // extra
      u16(0), // comment
      u16(0), // disk
      u16(0), // internal attributes
      u32(0), // external attributes
      u32(entry.offset),
      entry.name,
    ]);
    yield header;
    offset += header.length;
  }

  const centralSize = offset - centralStart;
  yield Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(written.length),
    u16(written.length),
    u32(centralSize),
    u32(centralStart),
    u16(0),
  ]);
}

/** The archive as a web stream, ready to be returned from a route handler. */
export function zipStream(
  entries: readonly ZipEntry[],
): ReadableStream<Uint8Array> {
  const iterator = buildArchive(entries);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
}
