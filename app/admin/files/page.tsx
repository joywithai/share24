import Link from 'next/link';
import { deleteFileAction } from '@/app/actions/admin';
import { ActionButton } from '@/components/admin/ActionButton';
import { AdminForm } from '@/components/admin/AdminForm';
import { Pagination } from '@/components/admin/Pagination';
import { Cell, Row, TableShell } from '@/components/admin/Table';
import { Badge } from '@/components/ui/badge';
import { formatBytes, pageInfo, searchTerm, shortDateTime } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { availableFiles } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * /admin/files — every stored file with the thing a listing cannot know from
 * the database alone: whether its bytes are actually there. Each row is checked
 * against its own storage provider, and the page says how many came back
 * missing.
 */
export default async function AdminFilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = searchTerm(params.q);
  const storage = ['LOCAL', 'R2'].includes(String(params.storage))
    ? String(params.storage)
    : '';

  const where = {
    ...(q
      ? {
          OR: [
            { fileName: { contains: q, mode: 'insensitive' as const } },
            { share: { route: { contains: q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
    ...(storage ? { storageType: storage as 'LOCAL' | 'R2' } : {}),
  };

  const total = await prisma.shareFile.count({ where });
  const info = pageInfo(params.page, total, 25);
  const files = await prisma.shareFile.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: info.skip,
    take: info.perPage,
    select: {
      id: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      storedPath: true,
      storageType: true,
      r2Key: true,
      r2Bucket: true,
      createdAt: true,
      share: {
        select: { id: true, route: true, isExpired: true, expiresAt: true },
      },
    },
  });

  const present = new Set((await availableFiles(files)).map((file) => file.id));
  const missingCount = files.filter((file) => !present.has(file.id)).length;
  const bytes = files.reduce((sum, file) => sum + file.fileSize, 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
          <p className="mt-1 text-sm text-sub">
            {total} file{total === 1 ? '' : 's'} · {formatBytes(bytes)} on this
            page
            {missingCount > 0 ? (
              <span className="text-danger">
                {' '}
                · {missingCount} missing from storage
              </span>
            ) : null}
          </p>
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          action="/admin/files"
        >
          {storage ? (
            <input type="hidden" name="storage" value={storage} />
          ) : null}
          <input
            name="q"
            defaultValue={q}
            placeholder="File or route…"
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
        {[
          { key: '', label: 'All storage' },
          { key: 'LOCAL', label: 'Local disk' },
          { key: 'R2', label: 'R2 bucket' },
        ].map((item) => (
          <Link
            key={item.key || 'all'}
            href={`/admin/files${item.key ? `?storage=${item.key}` : ''}`}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              storage === item.key
                ? 'bg-accent/15 font-medium text-accent'
                : 'text-sub hover:bg-card-soft hover:text-fg'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <TableShell
        head={['File', 'Share', 'Type', 'Size', 'Storage', 'Stored', '']}
        empty={total === 0 ? 'No files match.' : undefined}
      >
        {files.map((file) => {
          const there = present.has(file.id);
          return (
            <Row key={file.id}>
              <Cell>
                <span className="text-fg">{file.fileName}</span>
                {there ? null : (
                  <Badge variant="danger" className="ml-2">
                    missing
                  </Badge>
                )}
                <p className="mt-0.5 break-all font-mono text-[10px] text-sub">
                  {file.storedPath}
                </p>
              </Cell>
              <Cell>
                <Link
                  href={`/${file.share.route}`}
                  className="font-mono text-xs text-accent hover:underline"
                >
                  /{file.share.route}
                </Link>
                {file.share.isExpired ? (
                  <Badge variant="danger" className="ml-2">
                    expired
                  </Badge>
                ) : null}
              </Cell>
              <Cell className="text-xs text-sub">{file.mimeType}</Cell>
              <Cell className="text-xs text-sub">
                {formatBytes(file.fileSize)}
              </Cell>
              <Cell>
                <Badge
                  variant={file.storageType === 'LOCAL' ? 'neutral' : 'default'}
                >
                  {file.storageType === 'LOCAL' ? 'local' : file.storageType}
                </Badge>
              </Cell>
              <Cell className="text-xs text-sub">
                {shortDateTime(file.createdAt)}
              </Cell>
              <Cell>
                <AdminForm action={deleteFileAction}>
                  <input type="hidden" name="id" value={file.id} />
                  <ActionButton
                    variant="destructive"
                    confirm={`Delete ${file.fileName} from storage?`}
                  >
                    Delete
                  </ActionButton>
                </AdminForm>
              </Cell>
            </Row>
          );
        })}
      </TableShell>

      <Pagination
        info={info}
        basePath="/admin/files"
        params={{ q: q || undefined, storage: storage || undefined }}
      />
    </>
  );
}
