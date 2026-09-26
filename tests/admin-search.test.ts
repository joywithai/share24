import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The global search: what reaches the database, and how the hits are shaped.
 * Prisma is mocked — the interesting parts are the term handling, the caps and
 * the links each group produces.
 */

const shareFindMany = vi.fn();
const fileFindMany = vi.fn();
const userFindMany = vi.fn();
const eventFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    share: { findMany: (...args: unknown[]) => shareFindMany(...args) },
    shareFile: { findMany: (...args: unknown[]) => fileFindMany(...args) },
    user: { findMany: (...args: unknown[]) => userFindMany(...args) },
    securityEvent: { findMany: (...args: unknown[]) => eventFindMany(...args) },
  },
}));

const { globalSearch } = await import('@/lib/admin/search');

const future = new Date(Date.now() + 3600_000);

beforeEach(() => {
  vi.clearAllMocks();
  shareFindMany.mockResolvedValue([]);
  fileFindMany.mockResolvedValue([]);
  userFindMany.mockResolvedValue([]);
  eventFindMany.mockResolvedValue([]);
});

describe('globalSearch', () => {
  it('does not query anything for an empty or one-letter term', async () => {
    expect((await globalSearch('')).total).toBe(0);
    expect((await globalSearch(' a ')).total).toBe(0);
    expect(shareFindMany).not.toHaveBeenCalled();
  });

  it('groups the hits and links each one to its own page', async () => {
    shareFindMany.mockResolvedValue([
      {
        id: 's1',
        route: 'invoice-2026',
        type: 'file',
        isExpired: false,
        expiresAt: future,
        _count: { files: 3 },
      },
    ]);
    fileFindMany.mockResolvedValue([
      {
        id: 'f1',
        fileName: 'invoice.pdf',
        fileSize: 1024,
        storageType: 'R2',
        share: { route: 'invoice-2026' },
      },
    ]);
    userFindMany.mockResolvedValue([
      {
        id: 'u1',
        email: 'invoice@example.com',
        name: 'Invoice Bot',
        role: 'user',
        status: 'active',
      },
    ]);
    eventFindMany.mockResolvedValue([
      {
        id: 'e1',
        type: 'rate_limit',
        ip: '203.0.113.9',
        route: 'invoice-2026',
        detail: 'create: 20 per 10 min exceeded',
      },
    ]);

    const results = await globalSearch('invoice');

    expect(results.total).toBe(4);
    expect(results.shares[0]).toMatchObject({
      title: '/invoice-2026',
      href: '/admin/shares?q=invoice-2026',
      badge: 'file',
    });
    expect(results.files[0]).toMatchObject({
      title: 'invoice.pdf',
      href: '/admin/files?q=invoice.pdf',
      badge: 'R2',
    });
    expect(results.users[0].title).toBe('invoice@example.com');
    expect(results.events[0]).toMatchObject({
      badge: '203.0.113.9',
      href: '/admin/security?type=rate_limit',
    });
  });

  it('marks an expired share as expired rather than by its type', async () => {
    shareFindMany.mockResolvedValue([
      {
        id: 's2',
        route: 'old-thing',
        type: 'code',
        isExpired: false,
        expiresAt: new Date(Date.now() - 1000),
        _count: { files: 0 },
      },
    ]);

    const results = await globalSearch('old');
    expect(results.shares[0].badge).toBe('expired');
  });

  it('caps each group and reports the cap', async () => {
    shareFindMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        id: `s${index}`,
        route: `hit-${index}`,
        type: 'code',
        isExpired: false,
        expiresAt: future,
        _count: { files: 0 },
      })),
    );

    const results = await globalSearch('hit', 3);
    expect(results.shares).toHaveLength(3);
    expect(shareFindMany.mock.calls[0][0].take).toBe(3);
  });

  it('escapes LIKE wildcards so a literal % does not match everything', async () => {
    await globalSearch('50%_off');

    const where = shareFindMany.mock.calls[0][0].where;
    expect(where.route.contains).toBe('50\\%\\_off');
  });

  it('trims a long term before it reaches the database', async () => {
    await globalSearch(`x${'y'.repeat(200)}`);
    expect(shareFindMany.mock.calls[0][0].where.route.contains).toHaveLength(
      80,
    );
  });

  it('says so when nothing matches', async () => {
    const results = await globalSearch('nothing-here');
    expect(results.total).toBe(0);
    expect(results.shares).toEqual([]);
  });
});
