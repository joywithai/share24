import { describe, expect, it } from 'vitest';

import { bytesProblem, MISMATCH_MESSAGE, sniffBytes } from '@/lib/file-magic';

/** Byte builders for the signatures we claim to recognise. */
const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);
const padded = (prefix: Uint8Array, length = 64) => {
  const out = new Uint8Array(length);
  out.set(prefix);
  return out;
};

const PNG = padded(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
const JPEG = padded(bytes(0xff, 0xd8, 0xff, 0xe0));
const GIF = padded(text('GIF89a'));
const WEBP = padded(text('RIFF....WEBPVP8 ').subarray(0, 16));
const PDF = padded(text('%PDF-1.7\n1 0 obj'));

describe('sniffBytes', () => {
  it('recognises the image formats the app accepts', () => {
    expect(sniffBytes(PNG)).toBe('png');
    expect(sniffBytes(JPEG)).toBe('jpeg');
    expect(sniffBytes(GIF)).toBe('gif');
    expect(sniffBytes(WEBP)).toBe('webp');
  });

  it('recognises documents and text', () => {
    expect(sniffBytes(PDF)).toBe('pdf');
    expect(sniffBytes(text('hello, world\nsecond line'))).toBe('text');
    expect(sniffBytes(text('  <!doctype html><html></html>'))).toBe('html');
    expect(
      sniffBytes(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).toBe('svg');
  });

  it('recognises the kinds the app refuses', () => {
    expect(sniffBytes(padded(bytes(0x50, 0x4b, 0x03, 0x04)))).toBe('zip');
    expect(sniffBytes(padded(bytes(0x1f, 0x8b, 0x08)))).toBe('gzip');
    expect(sniffBytes(padded(bytes(0x37, 0x7a, 0xbc, 0xaf)))).toBe('7z');
    expect(sniffBytes(padded(bytes(0x52, 0x61, 0x72, 0x21)))).toBe('rar');
    expect(sniffBytes(padded(bytes(0x7f, 0x45, 0x4c, 0x46)))).toBe('elf');
    expect(sniffBytes(padded(bytes(0x4d, 0x5a)))).toBe('mz');
  });

  it('returns unknown for binary junk and empty files', () => {
    expect(sniffBytes(bytes())).toBe('unknown');
    expect(sniffBytes(bytes(0x00, 0x01, 0x02, 0x03))).toBe('unknown');
  });
});

describe('bytesProblem', () => {
  it('accepts an honest image', () => {
    expect(
      bytesProblem({ name: 'photo.png', type: 'image/png' }, PNG),
    ).toBeNull();
  });

  it('accepts a text file that really is text', () => {
    expect(
      bytesProblem({ name: 'notes.txt', type: 'text/plain' }, text('hi')),
    ).toBeNull();
    expect(
      bytesProblem({ name: 'data.csv', type: 'text/csv' }, text('a,b\n1,2\n')),
    ).toBeNull();
  });

  it('stops a renamed archive', () => {
    const problem = bytesProblem(
      { name: 'invoice.txt', type: 'text/plain' },
      padded(bytes(0x50, 0x4b, 0x03, 0x04)),
    );
    expect(problem).toMatch(/archive/i);
  });

  it('stops a renamed executable', () => {
    expect(
      bytesProblem(
        { name: 'report.pdf', type: 'application/pdf' },
        padded(bytes(0x7f, 0x45, 0x4c, 0x46)),
      ),
    ).toMatch(/executable/i);
    expect(
      bytesProblem(
        { name: 'setup.txt', type: 'text/plain' },
        padded(bytes(0x4d, 0x5a)),
      ),
    ).toMatch(/executable/i);
  });

  it('stops an image whose bytes are not that image', () => {
    expect(
      bytesProblem(
        { name: 'cat.png', type: 'image/png' },
        text('<html>boo</html>'),
      ),
    ).toBe(MISMATCH_MESSAGE);
    // A declared image type with unreadable bytes is refused too.
    expect(
      bytesProblem(
        { name: 'blob.jpg', type: 'image/jpeg' },
        bytes(0x00, 0x01, 0x02, 0x03),
      ),
    ).toBe(MISMATCH_MESSAGE);
  });

  it('stops a "PDF" that is really something else', () => {
    expect(
      bytesProblem(
        { name: 'invoice.pdf', type: 'application/pdf' },
        text('just text'),
      ),
    ).toBe(MISMATCH_MESSAGE);
  });

  it('refuses a picture whose name disagrees with its type', () => {
    // A JPEG called `picture.png`: the bytes and the name must agree, or the
    // download header lies about what the visitor gets.
    expect(bytesProblem({ name: 'picture.png', type: 'image/png' }, JPEG)).toBe(
      MISMATCH_MESSAGE,
    );
  });
});
