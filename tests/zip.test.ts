import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  crc32,
  safeEntryName,
  ZipSourceMissingError,
  zipStream,
} from '@/lib/zip';

/** Reads a stream to the end and returns the bytes. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

/** Minimal ZIP reader — enough to prove our writer produces a valid archive. */
function readZip(buffer: Buffer) {
  // End of central directory: walk back from the tail for its signature.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: { name: string; data: Buffer }[] = [];

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('bad central directory header');
    }
    const compression = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf8');

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('bad local file header');
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + size);

    const data = compression === 8 ? inflateRawSync(raw) : raw;

    entries.push({ name, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe('crc32', () => {
  it('matches the reference values', () => {
    expect(crc32(Buffer.from(''))).toBe(0);
    expect(crc32(Buffer.from('hello'))).toBe(0x3610a686);
    expect(
      crc32(Buffer.from('The quick brown fox jumps over the lazy dog')),
    ).toBe(0x414fa339);
  });
});

describe('safeEntryName', () => {
  it('strips directories and traversal', () => {
    expect(safeEntryName('../../etc/passwd')).toBe('passwd');
    expect(safeEntryName('C:\\Users\\me\\photo.png')).toBe('photo.png');
    expect(safeEntryName('...hidden')).toBe('hidden');
  });

  it('falls back to a usable name', () => {
    expect(safeEntryName('///')).toBe('file');
    expect(safeEntryName('a<b>c.txt')).toBe('a_b_c.txt');
  });
});

describe('zipStream', () => {
  it('round-trips several files, including an empty one', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zip-test-'));
    try {
      await writeFile(path.join(dir, 'first.txt'), 'hello there');
      await writeFile(path.join(dir, 'second.md'), '# notes\n\nwith a body\n');
      await writeFile(path.join(dir, 'empty.txt'), '');

      const stream = zipStream([
        {
          name: 'first.txt',
          source: { kind: 'path', path: path.join(dir, 'first.txt') },
        },
        {
          name: 'second.md',
          source: { kind: 'path', path: path.join(dir, 'second.md') },
        },
        {
          name: 'empty.txt',
          source: { kind: 'path', path: path.join(dir, 'empty.txt') },
        },
      ]);
      const archive = await drain(stream);
      const entries = readZip(archive);

      expect(entries.map((entry) => entry.name)).toEqual([
        'first.txt',
        'second.md',
        'empty.txt',
      ]);
      expect(entries[0].data.toString('utf8')).toBe('hello there');
      expect(entries[1].data.toString('utf8')).toBe('# notes\n\nwith a body\n');
      expect(entries[2].data.length).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('disambiguates two files that share a name', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zip-test-'));
    try {
      await writeFile(path.join(dir, 'a.txt'), 'one');
      await writeFile(path.join(dir, 'b.txt'), 'two');

      const archive = await drain(
        zipStream([
          {
            name: 'same.txt',
            source: { kind: 'path', path: path.join(dir, 'a.txt') },
          },
          {
            name: 'same.txt',
            source: { kind: 'path', path: path.join(dir, 'b.txt') },
          },
        ]),
      );
      const entries = readZip(archive);

      expect(entries.map((entry) => entry.name)).toEqual([
        'same.txt',
        'same-2.txt',
      ]);
      expect(entries[1].data.toString('utf8')).toBe('two');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('streams the archive in several chunks for larger input', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zip-test-'));
    try {
      const big = 'x'.repeat(2 * 1024 * 1024);
      await writeFile(path.join(dir, 'big.txt'), big);

      const reader = zipStream([
        {
          name: 'big.txt',
          source: { kind: 'path', path: path.join(dir, 'big.txt') },
        },
      ]).getReader();
      const sizes: number[] = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) sizes.push(value.length);
      }

      // header + compressed body + central directory + end record
      expect(sizes.length).toBeGreaterThanOrEqual(4);
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThan(
        big.length,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects when a file disappeared from disk', async () => {
    const stream = zipStream([
      { name: 'gone.txt', source: { kind: 'path', path: '/nope/gone.txt' } },
    ]);
    await expect(drain(stream)).rejects.toThrow();
  });

  it('packs an entry that comes from a lazy remote source', async () => {
    const bytes = Buffer.from('bytes from the bucket, not from this disk');
    const archive = await drain(
      zipStream([
        {
          name: 'remote.txt',
          source: { kind: 'remote', load: async () => bytes },
        },
      ]),
    );
    const entries = readZip(archive);

    expect(entries.map((entry) => entry.name)).toEqual(['remote.txt']);
    expect(entries[0].data.equals(bytes)).toBe(true);
  });

  it('fails loudly when a remote entry vanished mid-archive', async () => {
    const stream = zipStream([
      {
        name: 'gone-remote.txt',
        source: { kind: 'remote', load: async () => null },
      },
    ]);
    await expect(drain(stream)).rejects.toThrow(ZipSourceMissingError);
  });
});
