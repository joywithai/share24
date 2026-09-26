import { Pagination } from '@/components/admin/Pagination';
import { Cell, Row, TableShell } from '@/components/admin/Table';
import { Badge } from '@/components/ui/badge';
import { pageInfo, shortDateTime } from '@/lib/admin';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const ACTIONS = [
  'share.expire',
  'share.delete',
  'file.delete',
  'user.role',
  'user.status',
  'security.block',
  'security.unblock',
  'setting.update',
  'cleanup.run',
] as const;

/**
 * /admin/logs — who changed what, and what the cleanup job did on its own.
 *
 * The security page answers "what happened to the app"; this answers "who
 * touched it". Entries are written by the admin actions themselves.
 */
export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const action = ACTIONS.includes(
    String(params.action) as (typeof ACTIONS)[number],
  )
    ? String(params.action)
    : '';

  const where = action ? { action } : {};
  const total = await prisma.adminLog.count({ where });
  const info = pageInfo(params.page, total, 30);
  const [entries, cleanupRuns] = await Promise.all([
    prisma.adminLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: info.skip,
      take: info.perPage,
      select: {
        id: true,
        action: true,
        target: true,
        detail: true,
        createdAt: true,
        actor: { select: { email: true } },
      },
    }),
    prisma.securityEvent.count({ where: { type: 'maintenance' } }),
  ]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
          <p className="mt-1 text-sm text-sub">
            {total} admin action{total === 1 ? '' : 's'} · {cleanupRuns} cleanup
            run{cleanupRuns === 1 ? '' : 's'} recorded
          </p>
        </div>
        <form className="flex items-center gap-2" action="/admin/logs">
          <select
            name="action"
            defaultValue={action}
            className="h-9 rounded-md border border-line bg-card-soft px-3 text-sm text-fg outline-none focus:border-accent"
          >
            <option value="">Everything</option>
            {ACTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="h-9 rounded-md border border-line px-3 text-sm text-sub transition-colors hover:text-fg"
          >
            Filter
          </button>
        </form>
      </div>

      <TableShell
        head={['When', 'Action', 'Actor', 'Target', 'Detail']}
        empty={
          total === 0
            ? 'Nothing logged yet — admin actions and cleanup runs appear here.'
            : undefined
        }
      >
        {entries.map((entry) => (
          <Row key={entry.id}>
            <Cell className="whitespace-nowrap text-xs text-sub">
              {shortDateTime(entry.createdAt)}
            </Cell>
            <Cell>
              <Badge variant="neutral">{entry.action}</Badge>
            </Cell>
            <Cell className="text-xs text-sub">
              {entry.actor?.email ?? 'system'}
            </Cell>
            <Cell className="break-all font-mono text-[10px] text-sub">
              {entry.target ?? '—'}
            </Cell>
            <Cell className="max-w-[26rem] break-words text-xs text-sub">
              {entry.detail ?? '—'}
            </Cell>
          </Row>
        ))}
      </TableShell>

      <Pagination
        info={info}
        basePath="/admin/logs"
        params={{ action: action || undefined }}
      />
    </>
  );
}
