import {
  updateUserRoleAction,
  updateUserStatusAction,
} from '@/app/actions/admin';
import { ActionButton } from '@/components/admin/ActionButton';
import { AdminForm } from '@/components/admin/AdminForm';
import { Pagination } from '@/components/admin/Pagination';
import { Cell, Row, TableShell } from '@/components/admin/Table';
import { Badge } from '@/components/ui/badge';
import { currentAdmin, pageInfo, searchTerm, shortDateTime } from '@/lib/admin';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * /admin/users — roles and status.
 *
 * Suspending an account also drops its sessions (see the action), and the panel
 * refuses to let an admin demote or suspend themselves: the usual way to lock
 * yourself out of an admin panel is a checkbox.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = searchTerm(params.q);
  const admin = await currentAdmin();

  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: 'insensitive' as const } },
          { name: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const total = await prisma.user.count({ where });
  const info = pageInfo(params.page, total, 25);
  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: info.skip,
    take: info.perPage,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      lastSeenAt: true,
      _count: { select: { shares: true } },
    },
  });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-sub">
            {total} account{total === 1 ? '' : 's'}
          </p>
        </div>
        <form className="flex items-center gap-2" action="/admin/users">
          <input
            name="q"
            defaultValue={q}
            placeholder="Email or name…"
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

      <TableShell
        head={['Account', 'Role', 'Status', 'Shares', 'Seen', 'Joined', '']}
        empty={total === 0 ? 'No accounts match.' : undefined}
      >
        {users.map((user) => {
          const isSelf = user.id === admin?.id;
          return (
            <Row key={user.id}>
              <Cell>
                <span className="text-fg">{user.name || '—'}</span>
                <p className="text-xs text-sub">
                  {user.email}
                  {isSelf ? (
                    <span className="ml-1 text-accent">(you)</span>
                  ) : null}
                </p>
              </Cell>
              <Cell>
                <Badge variant={user.role === 'admin' ? 'default' : 'neutral'}>
                  {user.role}
                </Badge>
              </Cell>
              <Cell>
                <Badge
                  variant={user.status === 'active' ? 'success' : 'danger'}
                >
                  {user.status}
                </Badge>
              </Cell>
              <Cell className="text-xs text-sub">{user._count.shares}</Cell>
              <Cell className="text-xs text-sub">
                {user.lastSeenAt ? shortDateTime(user.lastSeenAt) : '—'}
              </Cell>
              <Cell className="text-xs text-sub">
                {shortDateTime(user.createdAt)}
              </Cell>
              <Cell>
                <div className="flex flex-wrap gap-2">
                  <AdminForm action={updateUserRoleAction}>
                    <input type="hidden" name="id" value={user.id} />
                    <input
                      type="hidden"
                      name="role"
                      value={user.role === 'admin' ? 'user' : 'admin'}
                    />
                    <ActionButton
                      confirm={
                        user.role === 'admin'
                          ? `Remove admin access from ${user.email}?`
                          : `Give ${user.email} admin access?`
                      }
                    >
                      {user.role === 'admin' ? 'Demote' : 'Make admin'}
                    </ActionButton>
                  </AdminForm>
                  <AdminForm action={updateUserStatusAction}>
                    <input type="hidden" name="id" value={user.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={user.status === 'active' ? 'suspended' : 'active'}
                    />
                    <ActionButton
                      variant={
                        user.status === 'active' ? 'destructive' : 'secondary'
                      }
                      confirm={
                        user.status === 'active'
                          ? `Suspend ${user.email}? Their sessions are closed immediately.`
                          : `Reactivate ${user.email}?`
                      }
                    >
                      {user.status === 'active' ? 'Suspend' : 'Activate'}
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
        basePath="/admin/users"
        params={{ q: q || undefined }}
      />
    </>
  );
}
