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

/** The environment each bucket provider needs before it can serve a byte. */
const PROVIDER_KEYS = {
  R2: [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
  ],
  B2: ['B2_ENDPOINT', 'B2_KEY_ID', 'B2_APPLICATION_KEY', 'B2_BUCKET_NAME'],
} as const;

const PROVIDER_LABEL: Record<string, string> = {
  LOCAL: 'the local disk',
  R2: 'Cloudflare R2',
  B2: 'Backblaze B2',
};

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
  const readyFor = (provider: 'R2' | 'B2') =>
    PROVIDER_KEYS[provider].every((key) => Boolean(process.env[key]?.trim()));
  const r2Ready = readyFor('R2');
  const b2Ready = readyFor('B2');
  const activeReady = type === 'B2' ? b2Ready : type === 'R2' ? r2Ready : true;
  const totalFiles = breakdown.reduce((sum, row) => sum + row.files, 0);
  const totalBytes = breakdown.reduce((sum, row) => sum + row.bytes, 0);

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Storage</h1>
        <p className="mt-1 text-sm text-sub">
          New uploads go to <strong>{PROVIDER_LABEL[type] ?? type}</strong>
          {activeReady ? '' : ' — credentials missing'}; existing files keep
          downloading from wherever they were written.
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
          label="In a bucket"
          value={breakdown
            .filter((row) => row.storageType !== 'LOCAL')
            .reduce((sum, row) => sum + row.files, 0)}
          hint={`R2 ${r2Ready ? 'ready' : 'not configured'} · B2 ${
            b2Ready ? 'ready' : 'not configured'
          }`}
          tone={!activeReady ? 'danger' : 'neutral'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Bucket configuration</CardTitle>
          <CardDescription>
            Only read when something actually uses a bucket. `STORAGE_TYPE`
            decides where new uploads land; the per-file rows decide where old
            ones are read from.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={type !== 'LOCAL' ? 'default' : 'neutral'}>
              STORAGE_TYPE = {type}
            </Badge>
            {(['R2', 'B2'] as const).flatMap((provider) =>
              PROVIDER_KEYS[provider].map((key) => (
                <Badge
                  key={key}
                  variant={process.env[key]?.trim() ? 'success' : 'neutral'}
                >
                  {key} {process.env[key]?.trim() ? 'set' : 'unset'}
                </Badge>
              )),
            )}
          </div>
          <p className="text-xs text-sub">
            R2 derives its endpoint from the account id (
            <code className="font-mono">
              https://&lt;account id&gt;.r2.cloudflarestorage.com
            </code>
            ); B2 uses the endpoint in{' '}
            <code className="font-mono">B2_ENDPOINT</code> with{' '}
            <code className="font-mono">B2_REGION</code> matching the bucket.
            Both are spoken over the S3 API — downloads are streamed by the app,
            so a bucket never has to be public and no CDN is involved.
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
