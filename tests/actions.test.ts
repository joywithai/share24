import { readdirSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server-action tests: the real action code runs, but the database and the
 * Next cookie store are mocked. File uploads are written to a temp dir set
 * up in tests/setup.ts (CORIUM_UPLOADS_DIR).
 */

const cookieStore = {
  set: vi.fn(),
  get: vi.fn().mockReturnValue(undefined),
};

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
}));

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => null), // anonymous by default
}));

const shareFindFirst = vi.fn();
const shareCreate = vi.fn();
const shareFindUnique = vi.fn();
const shareFileCreateMany = vi.fn();
const prismaMock = {
  share: {
    findFirst: shareFindFirst,
    create: shareCreate,
    findUnique: shareFindUnique,
  },
  shareFile: { createMany: shareFileCreateMany },
  $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
  ),
};

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

const { createCodeShare, createFileShare, verifyPinAction } = await import(
  '@/app/actions/share'
);
const { hashPin, verifyPin, unlockCookieName } = await import('@/lib/pin');
const { UPLOADS_ROOT } = await import('@/lib/storage');

beforeEach(() => {
  vi.clearAllMocks();
  shareFindFirst.mockResolvedValue(null);
  shareCreate.mockImplementation(async ({ data }) => data);
  shareFindUnique.mockResolvedValue(null);
  shareFileCreateMany.mockImplementation(async ({ data }) => data);
  cookieStore.get.mockReturnValue(undefined);
});

describe('createCodeShare', () => {
  it('creates a share with 24h expiry for an anonymous user', async () => {
    const before = Date.now();
    const result = await createCodeShare({
      code: 'hi',
      route: 'demo-share',
      pin: '',
    });

    expect(result).toEqual({ ok: true, route: 'demo-share' });
    expect(shareCreate).toHaveBeenCalledTimes(1);
    const data = shareCreate.mock.calls[0][0].data;
    expect(data.type).toBe('code');
    expect(data.content).toBe('hi');
    expect(data.userId).toBeNull();
    expect(data.pinHash).toBeNull();
    const ttl = new Date(data.expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(24 * 3600_000 - 5000);
    expect(ttl).toBeLessThanOrEqual(24 * 3600_000 + 5000);
  });

  it('normalizes the route (trim + lowercase)', async () => {
    await createCodeShare({ code: 'hi', route: '  My-Share ', pin: '' });
    const data = shareCreate.mock.calls[0][0].data;
    expect(data.route).toBe('my-share');
  });

  it('hashes the PIN with bcrypt and sets an unlock cookie', async () => {
    await createCodeShare({ code: 'hi', route: 'locked', pin: '4321' });

    const data = shareCreate.mock.calls[0][0].data;
    expect(data.pinHash).toMatch(/^\$2[aby]\$/);
    await expect(verifyPin('4321', data.pinHash)).resolves.toBe(true);

    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    const [name, token, options] = cookieStore.set.mock.calls[0];
    expect(name).toBe(unlockCookieName('locked'));
    expect(typeof token).toBe('string');
    expect(options.httpOnly).toBe(true);
  });

  it('rejects when the route is taken by an active share', async () => {
    shareFindFirst.mockResolvedValueOnce({ id: 'other' });
    const result = await createCodeShare({
      code: 'hi',
      route: 'taken-route',
      pin: '',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already in use/);
    expect(shareCreate).not.toHaveBeenCalled();
  });

  it('re-validates input server-side (empty content)', async () => {
    const result = await createCodeShare({ code: '', route: 'demo', pin: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Paste some code/);
    expect(shareCreate).not.toHaveBeenCalled();
  });

  it('re-validates the route server-side (reserved word)', async () => {
    const result = await createCodeShare({
      code: 'hi',
      route: 'login',
      pin: '',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/reserved/);
  });
});

describe('createFileShare', () => {
  /** One form, `files` repeated — the shape the picker posts. */
  function makeForm(files: File[], route: string, pin = '') {
    const fd = new FormData();
    for (const file of files) fd.append('files', file);
    fd.append('route', route);
    fd.append('pin', pin);
    return fd;
  }

  /** Every stored path the action asked the DB to record. */
  function storedPaths() {
    return shareFileCreateMany.mock.calls
      .flatMap((call) => call[0].data)
      .map((row: { storedPath: string }) => row.storedPath);
  }

  it('stores every file and creates a share with one row per file', async () => {
    const before = new Set(readdirSync(UPLOADS_ROOT));
    const files = [
      new File(['hello file'], 'notes.txt', { type: 'text/plain' }),
      new File(['a,b,c'], 'table.csv', { type: 'text/csv' }),
    ];

    const result = await createFileShare(makeForm(files, 'file-demo'));

    expect(result.ok).toBe(true);
    const shareData = shareCreate.mock.calls[0][0].data;
    expect(shareData.type).toBe('file');
    expect(shareData.fileUrl).toBeUndefined();

    const rows = shareFileCreateMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows.map((row: { position: number }) => row.position)).toEqual([
      0, 1,
    ]);
    expect(rows[0]).toMatchObject({
      shareId: shareData.id,
      fileName: 'notes.txt',
      fileSize: 'hello file'.length,
      mimeType: 'text/plain',
    });
    expect(rows[1].fileName).toBe('table.csv');

    // Both files exist on disk, under the share's own directory, in order.
    const { readFileSync } = await import('node:fs');
    expect(path.dirname(path.resolve(UPLOADS_ROOT, rows[0].storedPath))).toBe(
      path.dirname(path.resolve(UPLOADS_ROOT, rows[1].storedPath)),
    );
    expect(
      readFileSync(path.resolve(UPLOADS_ROOT, rows[0].storedPath), 'utf8'),
    ).toBe('hello file');
    expect(
      readFileSync(path.resolve(UPLOADS_ROOT, rows[1].storedPath), 'utf8'),
    ).toBe('a,b,c');

    const after = new Set(readdirSync(UPLOADS_ROOT));
    expect(after.size).toBe(before.size + 1);
  });

  it('keeps an upload name from escaping its directory', async () => {
    const file = new File(['x'], '../../evil.txt', { type: 'text/plain' });
    await createFileShare(makeForm([file], 'file-evil'));

    const [stored] = storedPaths();
    expect(stored).not.toContain('..');
    expect(
      path.resolve(UPLOADS_ROOT, stored).startsWith(path.resolve(UPLOADS_ROOT)),
    ).toBe(true);
  });

  it('accepts the legacy single `file` field as well', async () => {
    const fd = new FormData();
    fd.append(
      'file',
      new File(['old client'], 'legacy.txt', { type: 'text/plain' }),
    );
    fd.append('route', 'file-legacy');

    const result = await createFileShare(fd);
    expect(result.ok).toBe(true);
    expect(shareFileCreateMany.mock.calls[0][0].data[0].fileName).toBe(
      'legacy.txt',
    );
  });

  it('hashes the PIN when provided', async () => {
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    await createFileShare(makeForm([file], 'file-locked', '1357'));
    const data = shareCreate.mock.calls[0][0].data;
    expect(data.pinHash).toMatch(/^\$2[aby]\$/);
    await expect(verifyPin('1357', data.pinHash)).resolves.toBe(true);
  });

  it('rejects disallowed file types without writing anything', async () => {
    const before = new Set(readdirSync(UPLOADS_ROOT));
    const file = new File(['bad'], 'malware.zip', { type: 'application/zip' });
    const result = await createFileShare(makeForm([file], 'file-zip'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/can't be shared/);
    expect(shareCreate).not.toHaveBeenCalled();
    expect(new Set(readdirSync(UPLOADS_ROOT))).toEqual(before);
  });

  it('rejects oversized files', async () => {
    const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', {
      type: 'image/png',
    });
    const result = await createFileShare(makeForm([file], 'file-big'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/10 MB/);
  });

  it('refuses a set of more than ten files', async () => {
    const files = Array.from(
      { length: 11 },
      (_, i) => new File(['x'], `f${i}.txt`, { type: 'text/plain' }),
    );
    const result = await createFileShare(makeForm(files, 'file-many'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/10 files at most/);
    expect(shareCreate).not.toHaveBeenCalled();
  });

  it('rejects when the files are missing from the form', async () => {
    const fd = new FormData();
    fd.append('route', 'no-file');
    const result = await createFileShare(fd);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/at least one file/);
  });

  it('cleans up the uploaded files when the route is taken', async () => {
    shareFindFirst.mockResolvedValueOnce({ id: 'other' });
    const before = new Set(readdirSync(UPLOADS_ROOT));
    const files = [
      new File(['x'], 'oops.txt', { type: 'text/plain' }),
      new File(['y'], 'oops2.txt', { type: 'text/plain' }),
    ];
    const result = await createFileShare(makeForm(files, 'taken-file'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already in use/);
    // The just-written directory was removed again.
    expect(new Set(readdirSync(UPLOADS_ROOT))).toEqual(before);
  });
});

describe('verifyPinAction', () => {
  function pinForm(shareId: string, route: string, pin: string) {
    const fd = new FormData();
    fd.append('shareId', shareId);
    fd.append('route', route);
    fd.append('pin', pin);
    return fd;
  }

  it('rejects an unknown share', async () => {
    const result = await verifyPinAction(
      { ok: false },
      pinForm('nope', 'route-a', '1234'),
    );
    expect(result.ok).toBe(false);
    expect(result.expired).toBe(true);
  });

  it('rejects an expired share', async () => {
    shareFindUnique.mockResolvedValueOnce({
      route: 'route-a',
      pinHash: null,
      isExpired: true,
      expiresAt: new Date(Date.now() - 1000),
    });
    const result = await verifyPinAction(
      { ok: false },
      pinForm('id-1', 'route-a', '1234'),
    );
    expect(result.ok).toBe(false);
    expect(result.expired).toBe(true);
  });

  it('rejects a wrong PIN', async () => {
    const pinHash = await hashPin('1234');
    shareFindUnique.mockResolvedValueOnce({
      route: 'route-a',
      pinHash,
      isExpired: false,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const result = await verifyPinAction(
      { ok: false },
      pinForm('id-1', 'route-a', '0000'),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Incorrect PIN/);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('accepts the right PIN and sets the unlock cookie', async () => {
    const pinHash = await hashPin('1234');
    shareFindUnique.mockResolvedValueOnce({
      route: 'route-a',
      pinHash,
      isExpired: false,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const result = await verifyPinAction(
      { ok: false },
      pinForm('id-1', 'route-a', '1234'),
    );
    expect(result.ok).toBe(true);
    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    expect(cookieStore.set.mock.calls[0][0]).toBe(unlockCookieName('route-a'));
  });
});
