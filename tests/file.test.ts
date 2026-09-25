import { describe, expect, it } from 'vitest';

import {
  BLOCKED_EXTENSIONS,
  extensionOf,
  fileProblem,
  formatBytes,
  KNOWN_MIME_TYPES,
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

  it('accepts ordinary developer files of any extension', () => {
    const friendly = [
      { name: 'notes.txt', type: 'text/plain' },
      { name: 'app.js', type: 'text/javascript' },
      { name: 'style.css', type: 'text/css' },
      { name: 'main.cpp', type: 'text/x-c++src' },
      { name: 'data.json', type: 'application/json' },
      { name: 'readme.md', type: 'text/markdown' },
      { name: 'photo.png', type: 'image/png' },
      { name: 'scan.pdf', type: 'application/pdf' },
      { name: 'Makefile', type: '' }, // no extension at all
      { name: 'weird.qzx', type: '' }, // unknown extension
    ];
    for (const file of friendly) {
      expect(fileProblem({ ...file, size: 10 }), file.name).toBeNull();
    }
  });

  it('accepts the documented document/image types', () => {
    for (const ext of Object.keys(KNOWN_MIME_TYPES)) {
      const file = { name: `f.${ext}`, type: KNOWN_MIME_TYPES[ext], size: 10 };
      expect(fileProblem(file), ext).toBeNull();
    }
  });

  it('rejects blocked extensions (archives, executables, web, media)', () => {
    for (const name of [
      'evil.zip',
      'bundle.rar',
      'image.iso',
      'malware.exe',
      'lib.dll',
      'page.html',
      'icon.svg',
      'movie.mp4',
      'clip.webm',
      'song.mp3',
    ]) {
      expect(fileProblem({ name, type: '', size: 10 }), name).toMatch(
        /can't be shared/,
      );
    }
    // …and the whole block-list stays consistent with the message.
    expect(BLOCKED_EXTENSIONS.size).toBeGreaterThan(30);
  });

  it('rejects blocked MIME types even behind an innocent name', () => {
    expect(
      fileProblem({ name: 'f.weird', type: 'video/mp4', size: 10 }),
    ).toMatch(/can't be shared/);
    expect(
      fileProblem({ name: 'f.weird', type: 'audio/mpeg', size: 10 }),
    ).toMatch(/can't be shared/);
    expect(
      fileProblem({ name: 'f.weird', type: 'application/zip', size: 10 }),
    ).toMatch(/can't be shared/);
  });

  it('rejects oversized files (10 MB cap)', () => {
    expect(
      fileProblem({
        name: 'big.txt',
        type: 'text/plain',
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
