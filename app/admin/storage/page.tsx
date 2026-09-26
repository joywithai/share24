import { runCleanupAction, scanStorageAction } from '@/app/actions/maintenance';
import { ActionButton } from '@/components/admin/ActionButton';
import { AdminForm } from '@/components/admin/AdminForm';
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
import { formatBytes } from '@/lib/admin';
import { orphanScan, storageBreakdown } from '@/lib/admin/stats';
import { configuredStorageType, uploadsRoot } from '@/lib/storage';

export const dynamic = 'force-dynamic';

const R2_KEYS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
] as const;

/**
 * /admin/storage — where the bytes are, whether they are still there, and
 * which provider a *new* upload would use.
 *
 * The scan is bounded (the newest 500 rows plus a look at the uploads folder)
 * so it stays a button an operator can press while the app is live.
 */
export default async function AdminStoragePage() {
  const [breakdown, scan] = await Promise.all([
    storageBreakdown(),
    orphanScan(500),
  ]);

  const type = configuredStorageType();
  const r2Ready = R2_KEYS.every((key) => Boolean(process.env[key]?.trim()));
  const totalFiles = breakdown.reduce((sum, row) => sum + row.files, 0);
  const totalBytes = breakdown.reduce((sum, row) => sum + row.bytes, 0);

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Storage</h1>
        <p className="mt-1 text-sm text-sub">
          New uploads go to{' '}
          <strong>{type === 'R2' ? 'Cloudflare R2' : 'the local disk'}</strong>;
          existing files keep downloading from wherever they were written.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Files" value={totalFiles} />
        <StatCard label="Bytes" value={formatBytes(totalBytes)} />
        <StatCard
          label="On the local disk"
          value={
            breakdown.find((row) => row.storageType === 'LOCAL')?.files ?? 0
          }
          hint={uploadsRoot()}
        />
        <StatCard
          label="In the R2 bucket"
          value={breakdown.find((row) => row.storageType === 'R2')?.files ?? 0}
          hint={r2Ready ? 'credentials configured' : 'credentials missing'}
          tone={type === 'R2' && !r2Ready ? 'danger' : 'neutral'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">R2 configuration</CardTitle>
          <CardDescription>
            Only read when something actually uses R2. `STORAGE_TYPE` decides
            where new uploads land; the per-file rows decide where old ones are
            read from.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={type === 'R2' ? 'default' : 'neutral'}>
              STORAGE_TYPE = {type}
            </Badge>
            {R2_KEYS.map((key) => (
              <Badge
                key={key}
                variant={process.env[key]?.trim() ? 'success' : 'neutral'}
              >
                {key} {process.env[key]?.trim() ? 'set' : 'unset'}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-sub">
            Endpoint is derived from the account id:{' '}
            <code className="font-mono">
              https://&lt;account id&gt;.r2.cloudflarestorage.com
            </code>{' '}
            — downloads are streamed by the app, so the bucket never has to be
            public and no CDN is involved.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm">Consistency scan</CardTitle>
            <CardDescription>
              Checked the newest {scan.checked} rows and the uploads folder.
            </CardDescription>
          </div>
          <AdminForm action={scanStorageAction}>
            <ActionButton>Re-check</ActionButton>
          </AdminForm>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className={scan.missing.length > 0 ? 'text-danger' : 'text-ok'}>
            {scan.missing.length === 0
              ? 'Every checked row still has its bytes.'
              : `${scan.missing.length} row(s) lost their bytes.`}
          </p>
          <p
            className={scan.strayFiles.length > 0 ? 'text-danger' : 'text-sub'}
          >
            {scan.strayFiles.length === 0
              ? 'No unclaimed files on the local disk.'
              : `${scan.strayFiles.length} file(s) on disk belong to no share.`}
          </p>
          <AdminForm action={runCleanupAction} className="pt-2">
            <ActionButton
              variant="destructive"
              confirm="Delete expired shares, orphaned files and expired blocks now?"
            >
              Run cleanup now
            </ActionButton>
          </AdminForm>
        </CardContent>
      </Card>

      {scan.missing.length > 0 ? (
        <TableShell head={['Share', 'File', 'Storage', 'Stored path']}>
          {scan.missing.slice(0, 25).map((row) => (
            <Row key={row.id}>
              <Cell className="font-mono text-xs text-sub">{row.shareId}</Cell>
              <Cell className="text-xs">{row.fileName}</Cell>
              <Cell className="text-xs text-sub">{row.storageType}</Cell>
              <Cell className="break-all font-mono text-[10px] text-sub">
                {row.storedPath}
              </Cell>
            </Row>
          ))}
        </TableShell>
      ) : null}

      {scan.strayFiles.length > 0 ? (
        <TableShell head={['Path on disk', 'Bytes']}>
          {scan.strayFiles.slice(0, 25).map((row) => (
            <Row key={row.path}>
              <Cell className="break-all font-mono text-[10px] text-sub">
                {row.path}
              </Cell>
              <Cell className="text-xs text-sub">{formatBytes(row.bytes)}</Cell>
            </Row>
          ))}
        </TableShell>
      ) : null}
    </>
  );
}
