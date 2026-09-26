import Link from 'next/link';

import { BarChart } from '@/components/admin/BarChart';
import { StatCard } from '@/components/admin/StatCard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatBytes, shortDateTime } from '@/lib/admin';
import { dailySeries, dashboardStats, recentShares } from '@/lib/admin/stats';
import { maintenanceState } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/** /admin — the numbers an operator wants first. */
export default async function AdminDashboardPage() {
  const [stats, shares, shareSeries, eventSeries, maintenance] =
    await Promise.all([
      dashboardStats(),
      recentShares(6),
      dailySeries('shares', 14),
      dailySeries('events', 14),
      maintenanceState(),
    ]);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-sub">
            Everything the app knows, in one screen.
          </p>
        </div>
        {maintenance.active ? (
          <Badge variant="danger">Maintenance mode is on</Badge>
        ) : (
          <Badge variant="success">Serving visitors</Badge>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active shares"
          value={stats.shares.active}
          hint={`${stats.shares.createdToday} created today · ${stats.expiringSoon} expire within 6h`}
        />
        <StatCard
          label="Files stored"
          value={stats.files.count}
          hint={`${formatBytes(stats.files.bytes)} · ${stats.files.r2} on R2, ${stats.files.local} local`}
        />
        <StatCard
          label="Expired, not cleaned"
          value={stats.shares.expired}
          hint="Removed by the cleanup job"
          tone={stats.shares.expired > 100 ? 'danger' : 'neutral'}
        />
        <StatCard
          label="Security events (24h)"
          value={stats.security.events24h}
          hint={`${stats.security.rateLimited24h} rate limits · ${stats.security.pinFailures24h} wrong PINs`}
          tone={stats.security.events24h > 50 ? 'danger' : 'neutral'}
        />
        <StatCard
          label="Users"
          value={stats.users.total}
          hint={`${stats.users.admins} admin · ${stats.users.suspended} suspended`}
        />
        <StatCard
          label="Blocked addresses"
          value={stats.security.blocked}
          hint="See Security to unblock"
          tone={stats.security.blocked > 0 ? 'danger' : 'neutral'}
        />
        <StatCard
          label="Total shares"
          value={stats.shares.total}
          hint="All time, expired included"
        />
        <StatCard
          label="Storage backend"
          value={
            process.env.STORAGE_TYPE?.toUpperCase() === 'R2'
              ? 'R2'
              : 'Local disk'
          }
          hint="New uploads land here — see Storage"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BarChart data={shareSeries} label="Shares created" />
        <BarChart data={eventSeries} label="Security events" tone="danger" />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-sm">Latest shares</CardTitle>
          <Link
            href="/admin/shares"
            className="text-xs text-accent hover:underline"
          >
            All shares →
          </Link>
        </CardHeader>
        <CardContent className="space-y-2">
          {shares.length === 0 ? (
            <p className="text-sm text-sub">No shares yet.</p>
          ) : (
            shares.map((share) => {
              const expired =
                share.isExpired || share.expiresAt.getTime() <= Date.now();
              return (
                <div
                  key={share.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/70 px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <code className="font-mono text-xs text-fg">
                      /{share.route}
                    </code>
                    <Badge variant="neutral">{share.type}</Badge>
                    {share.hasPin ? <Badge variant="neutral">PIN</Badge> : null}
                    {expired ? <Badge variant="danger">expired</Badge> : null}
                  </span>
                  <span className="text-xs text-sub">
                    {share.files} file{share.files === 1 ? '' : 's'} ·{' '}
                    {formatBytes(share.sizeBytes)} ·{' '}
                    {shortDateTime(share.createdAt)}
                  </span>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </>
  );
}
