import { describe, expect, it } from 'vitest';

import {
  ALLOWED_EXTENSIONS,
  extensionOf,
  fileProblem,
  formatBytes,
  MAX_FILE_BYTES,
  mimeTypeFor,
} from '@/lib/file';

describe('extensionOf', () => {
  it('extracts lowercase extensions', () => {
    expect(extensionOf('photo.PNG')).toBe('png');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });

  it('ignores path segments (no traversal)', () => {
    expect(extensionOf('../../etc/passwd')).toBeNull();
    expect(extensionOf('dir\\..\\malware.exe')).toBe('exe');
  });

  it('returns null for missing/dangling dots', () => {
    expect(extensionOf('noextension')).toBeNull();
    expect(extensionOf('.hidden')).toBeNull();
    expect(extensionOf('trailing.')).toBeNull();
  });
});

describe('fileProblem', () => {
  const ok = { name: 'notes.txt', type: 'text/plain', size: 100 };

  it('accepts every allowed type', () => {
    for (const ext of Object.keys(ALLOWED_EXTENSIONS)) {
      const file = {
        name: `f.${ext}`,
        type: ALLOWED_EXTENSIONS[ext],
        size: 10,
      };
      expect(fileProblem(file), ext).toBeNull();
    }
  });

  it('accepts generic browser MIME types for known extensions', () => {
    expect(
      fileProblem({
        name: 'f.docx',
        type: 'application/octet-stream',
        size: 10,
      }),
    ).toBeNull();
    expect(fileProblem({ name: 'f.pdf', type: '', size: 10 })).toBeNull();
  });

  it('rejects disallowed types', () => {
    expect(
      fileProblem({ name: 'evil.zip', type: 'application/zip', size: 10 }),
    ).toMatch(/Only PNG/);
    expect(
      fileProblem({
        name: 'evil.exe',
        type: 'application/x-msdownload',
        size: 10,
      }),
    ).toMatch(/Only PNG/);
    expect(
      fileProblem({
        name: 'big.iso',
        type: 'application/x-iso9660-image',
        size: 10,
      }),
    ).toMatch(/Only PNG/);
    expect(
      fileProblem({ name: 'clip.html', type: 'text/html', size: 10 }),
    ).toMatch(/Only PNG/);
  });

  it('rejects MIME/extension mismatch', () => {
    expect(
      fileProblem({ name: 'sneaky.png', type: 'application/pdf', size: 10 }),
    ).toMatch(/does not match/);
  });

  it('rejects oversized files (10 MB cap)', () => {
    expect(
      fileProblem({
        name: 'big.png',
        type: 'image/png',
        size: MAX_FILE_BYTES + 1,
      }),
    ).toMatch(/10 MB/);
    expect(fileProblem({ ...ok, size: MAX_FILE_BYTES })).toBeNull();
  });

  it('rejects empty files', () => {
    expect(fileProblem({ ...ok, size: 0 })).toMatch(/empty/);
  });

  it('accepts the baseline file', () => {
    expect(fileProblem(ok)).toBeNull();
  });
});

describe('mimeTypeFor', () => {
  it('prefers the extension mapping', () => {
    expect(mimeTypeFor('f.jpeg', 'application/octet-stream')).toBe(
      'image/jpeg',
    );
    expect(mimeTypeFor('f.txt', 'text/html')).toBe('text/plain');
  });

  it('falls back to the declared type for unknown extensions', () => {
    expect(mimeTypeFor('f.unknown', 'application/xyz')).toBe('application/xyz');
    expect(mimeTypeFor('f.unknown', '')).toBe('application/octet-stream');
  });
});

describe('formatBytes', () => {
  it('formats B/KB/MB/GB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });
});
