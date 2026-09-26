import Link from 'next/link';
import { blockIpAction, unblockIpAction } from '@/app/actions/admin';
import { ActionButton } from '@/components/admin/ActionButton';
import { AdminForm } from '@/components/admin/AdminForm';
import { Pagination } from '@/components/admin/Pagination';
import { StatCard } from '@/components/admin/StatCard';
import { Cell, Row, TableShell } from '@/components/admin/Table';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { pageInfo, shortDateTime } from '@/lib/admin';
import { dashboardStats } from '@/lib/admin/stats';
import { prisma } from '@/lib/prisma';
import { RATE_LIMITS } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

const EVENT_TYPES = [
  'rate_limit',
  'pin_failure',
  'blocked_ip',
  'suspicious_upload',
  'login_failure',
  'forbidden',
  'maintenance',
] as const;

/**
 * /admin/security — the two things an operator acts on: the trail of events,
 * and who is currently blocked. Blocking is one form; unblocking is one click.
 */
export default async function AdminSecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const type = EVENT_TYPES.includes(
    String(params.type) as (typeof EVENT_TYPES)[number],
  )
    ? String(params.type)
    : '';
  const severity = ['info', 'warning', 'critical'].includes(
    String(params.severity),
  )
    ? String(params.severity)
    : '';

  const where = {
    ...(type ? { type: type as (typeof EVENT_TYPES)[number] } : {}),
    ...(severity ? { severity } : {}),
  };

  const now = new Date();
  const [stats, total, blocked, last24h] = await Promise.all([
    dashboardStats(),
    prisma.securityEvent.count({ where }),
    prisma.blockedIp.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    prisma.securityEvent.count({
      where: { createdAt: { gte: new Date(now.getTime() - 86_400_000) } },
    }),
  ]);

  const info = pageInfo(params.page, total, 25);
  const events = await prisma.securityEvent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: info.skip,
    take: info.perPage,
  });

  const limits = Object.entries(RATE_LIMITS);

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="mt-1 text-sm text-sub">
          Rate limits, blocked addresses and everything the guards noticed.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Events (24h)" value={last24h} />
        <StatCard
          label="Rate limit hits (24h)"
          value={stats.security.rateLimited24h}
          tone={stats.security.rateLimited24h > 20 ? 'danger' : 'neutral'}
        />
        <StatCard
          label="Wrong PINs (24h)"
          value={stats.security.pinFailures24h}
          tone={stats.security.pinFailures24h > 20 ? 'danger' : 'neutral'}
        />
        <StatCard
          label="Blocked addresses"
          value={blocked.length}
          tone={blocked.length > 0 ? 'danger' : 'ok'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Block an address</CardTitle>
          <CardDescription>
            Blocking takes effect within seconds and stops every action and
            download from that address.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdminForm
            action={blockIpAction}
            className="flex flex-wrap items-end gap-2"
          >
            <label className="flex flex-col gap-1 text-xs text-sub">
              Address
              <input
                name="ip"
                required
                placeholder="203.0.113.7"
                className="h-9 w-44 rounded-md border border-line bg-card-soft px-3 font-mono text-sm text-fg outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-sub">
              Minutes (0 = permanent)
              <input
                name="minutes"
                type="number"
                min={0}
                defaultValue={60}
                className="h-9 w-32 rounded-md border border-line bg-card-soft px-3 text-sm text-fg outline-none focus:border-accent"
              />
            </label>
            <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs text-sub">
              Reason
              <input
                name="reason"
                placeholder="abusive downloads"
                className="h-9 w-full rounded-md border border-line bg-card-soft px-3 text-sm text-fg outline-none focus:border-accent"
              />
            </label>
            <ActionButton variant="destructive" size="default">
              Block
            </ActionButton>
          </AdminForm>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-medium">Blocked now</h2>
        <TableShell
          head={['Address', 'Reason', 'By', 'Expires', '']}
          empty={blocked.length === 0 ? 'Nothing is blocked.' : undefined}
        >
          {blocked.map((entry) => {
            const expired = Boolean(
              entry.expiresAt && entry.expiresAt.getTime() <= now.getTime(),
            );
            return (
              <Row key={entry.id}>
                <Cell className="font-mono text-xs">{entry.ip}</Cell>
                <Cell className="text-xs text-sub">{entry.reason ?? '—'}</Cell>
                <Cell className="text-xs text-sub">
                  {entry.blockedBy ?? '—'}
                </Cell>
                <Cell className="text-xs">
                  {entry.expiresAt ? (
                    expired ? (
                      <Badge variant="neutral">expired</Badge>
                    ) : (
                      <span className="text-sub">
                        {shortDateTime(entry.expiresAt)}
                      </span>
                    )
                  ) : (
                    <Badge variant="danger">permanent</Badge>
                  )}
                </Cell>
                <Cell>
                  <AdminForm action={unblockIpAction}>
                    <input type="hidden" name="ip" value={entry.ip} />
                    <ActionButton confirm={`Unblock ${entry.ip}?`}>
                      Unblock
                    </ActionButton>
                  </AdminForm>
                </Cell>
              </Row>
            );
          })}
        </TableShell>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/admin/security"
          className={`rounded-md px-3 py-1.5 text-sm ${type === '' ? 'bg-accent/15 font-medium text-accent' : 'text-sub hover:bg-card-soft hover:text-fg'}`}
        >
          Everything
        </Link>
        {EVENT_TYPES.map((eventType) => (
          <Link
            key={eventType}
            href={`/admin/security?type=${eventType}`}
            className={`rounded-md px-3 py-1.5 text-sm ${type === eventType ? 'bg-accent/15 font-medium text-accent' : 'text-sub hover:bg-card-soft hover:text-fg'}`}
          >
            {eventType.replace('_', ' ')}
          </Link>
        ))}
      </div>

      <TableShell
        head={['When', 'Type', 'Severity', 'Address', 'Route', 'Detail']}
        empty={total === 0 ? 'No events match that filter.' : undefined}
      >
        {events.map((event) => (
          <Row key={event.id}>
            <Cell className="whitespace-nowrap text-xs text-sub">
              {shortDateTime(event.createdAt)}
            </Cell>
            <Cell>
              <Badge
                variant={
                  event.severity === 'critical'
                    ? 'danger'
                    : event.severity === 'info'
                      ? 'neutral'
                      : 'default'
                }
              >
                {event.type}
              </Badge>
            </Cell>
            <Cell className="text-xs text-sub">{event.severity}</Cell>
            <Cell className="font-mono text-xs text-sub">
              {event.ip ?? '—'}
            </Cell>
            <Cell className="font-mono text-xs text-sub">
              {event.route ? `/${event.route}` : '—'}
            </Cell>
            <Cell className="max-w-[24rem] break-words text-xs text-sub">
              {event.detail ?? '—'}
            </Cell>
          </Row>
        ))}
      </TableShell>

      <Pagination
        info={info}
        basePath="/admin/security"
        params={{ type: type || undefined, severity: severity || undefined }}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Active rate limits</CardTitle>
          <CardDescription>
            Counters live in memory, or in Redis when `UPSTASH_REDIS_REST_URL`
            is set — which is what makes them correct across instances.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {limits.map(([kind, rule]) => (
              <li
                key={kind}
                className="flex items-center justify-between rounded-lg border border-line/70 px-3 py-2"
              >
                <code className="font-mono text-xs text-fg">{kind}</code>
                <span className="text-xs text-sub">
                  {rule.max} / {Math.round(rule.windowMs / 60_000)} min
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
