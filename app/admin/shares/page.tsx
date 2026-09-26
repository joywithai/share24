import Link from 'next/link';
import { deleteShareAction, expireShareAction } from '@/app/actions/admin';
import { ActionButton } from '@/components/admin/ActionButton';
import { AdminForm } from '@/components/admin/AdminForm';
import { Pagination } from '@/components/admin/Pagination';
import { Cell, Row, TableShell } from '@/components/admin/Table';
import { Badge } from '@/components/ui/badge';
import { formatBytes, pageInfo, searchTerm, shortDateTime } from '@/lib/admin';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type Filter = 'active' | 'expired' | 'all';

/**
 * /admin/shares — every share, with the two actions that matter: make it
 * expire now, or remove it (and its bytes) for good.
 */
export default async function AdminSharesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = searchTerm(params.q);
  const filter = (
    ['active', 'expired', 'all'].includes(String(params.status))
      ? String(params.status)
      : 'active'
  ) as Filter;

  const now = new Date();
  const where = {
    ...(q ? { route: { contains: q, mode: 'insensitive' as const } } : {}),
    ...(filter === 'active'
      ? { isExpired: false, expiresAt: { gt: now } }
      : filter === 'expired'
        ? { OR: [{ isExpired: true }, { expiresAt: { lte: now } }] }
        : {}),
  };

  const total = await prisma.share.count({ where });
  const info = pageInfo(params.page, total, 25);
  const shares = await prisma.share.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: info.skip,
    take: info.perPage,
    select: {
      id: true,
      route: true,
      type: true,
      expiresAt: true,
      isExpired: true,
      pinHash: true,
      createdAt: true,
      user: { select: { email: true } },
      files: { select: { fileSize: true } },
    },
  });

  const filters: { key: Filter; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'expired', label: 'Expired' },
    { key: 'all', label: 'All' },
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shares</h1>
          <p className="mt-1 text-sm text-sub">
            {total} {filter === 'all' ? '' : `${filter} `}share
            {total === 1 ? '' : 's'}
          </p>
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          action="/admin/shares"
        >
          <input type="hidden" name="status" value={filter} />
          <input
            name="q"
            defaultValue={q}
            placeholder="Filter by route…"
            className="h-9 w-48 rounded-md border border-line bg-card-soft px-3 text-sm text-fg outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="h-9 rounded-md border border-line px-3 text-sm text-sub transition-colors hover:text-fg"
          >
            Search
          </button>
        </form>
      </div>

      <div className="flex gap-2">
        {filters.map((item) => (
          <Link
            key={item.key}
            href={`/admin/shares?status=${item.key}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              filter === item.key
                ? 'bg-accent/15 font-medium text-accent'
                : 'text-sub hover:bg-card-soft hover:text-fg'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <TableShell
        head={['Route', 'Type', 'Files', 'Author', 'Created', 'Expires', '']}
        empty={total === 0 ? 'Nothing matches that filter.' : undefined}
      >
        {shares.map((share) => {
          const expired =
            share.isExpired || share.expiresAt.getTime() <= now.getTime();
          const bytes = share.files.reduce(
            (sum, file) => sum + file.fileSize,
            0,
          );
          return (
            <Row key={share.id}>
              <Cell>
                <Link
                  href={`/${share.route}`}
                  className="font-mono text-xs text-accent hover:underline"
                >
                  /{share.route}
                </Link>
                {share.pinHash ? (
                  <span className="ml-2 text-[10px] uppercase text-sub">
                    PIN
                  </span>
                ) : null}
              </Cell>
              <Cell>
                <Badge variant="neutral">{share.type}</Badge>
              </Cell>
              <Cell className="text-sub">
                {share.files.length}
                {share.files.length > 0 ? (
                  <span className="text-xs"> · {formatBytes(bytes)}</span>
                ) : null}
              </Cell>
              <Cell className="text-xs text-sub">
                {share.user?.email ?? 'anonymous'}
              </Cell>
              <Cell className="text-xs text-sub">
                {shortDateTime(share.createdAt)}
              </Cell>
              <Cell>
                {expired ? (
                  <Badge variant="danger">expired</Badge>
                ) : (
                  <span className="text-xs text-sub">
                    {shortDateTime(share.expiresAt)}
                  </span>
                )}
              </Cell>
              <Cell>
                <div className="flex gap-2">
                  {expired ? null : (
                    <AdminForm action={expireShareAction}>
                      <input type="hidden" name="id" value={share.id} />
                      <ActionButton confirm={`Expire /${share.route} now?`}>
                        Expire
                      </ActionButton>
                    </AdminForm>
                  )}
                  <AdminForm action={deleteShareAction}>
                    <input type="hidden" name="id" value={share.id} />
                    <ActionButton
                      variant="destructive"
                      confirm={`Delete /${share.route} and its files for good?`}
                    >
                      Delete
                    </ActionButton>
                  </AdminForm>
                </div>
              </Cell>
            </Row>
          );
        })}
      </TableShell>

      <Pagination
        info={info}
        basePath="/admin/shares"
        params={{ status: filter, q: q || undefined }}
      />
    </>
  );
}
