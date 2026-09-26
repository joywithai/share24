import { readFile } from 'node:fs/promises';

import { authorizeDownload } from '@/lib/downloads';
import { resolveStoredPath } from '@/lib/storage';
import { safeEntryName, zipStream } from '@/lib/zip';

export const dynamic = 'force-dynamic';

/**
 * /<route>/download — the whole share.
 *
 * One file: served as itself (so single-file links keep working exactly as
 * before). Several files: bundled into one ZIP, streamed as it is built —
 * handy when somebody shared ten screenshots under one name.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ route: string }> },
) {
  const { route } = await context.params;

  const access = await authorizeDownload(request, route);
  if (!access.ok) return access.response;

  // Never trust the stored paths — each must resolve inside the uploads root.
  const resolved = access.files.map((file) => ({
    file,
    absolute: resolveStoredPath(file.storedPath),
  }));
  if (resolved.some((entry) => entry.absolute === null)) {
    return new Response('Invalid file reference.', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (resolved.length === 1) {
    const [{ file, absolute }] = resolved;
    let data: Buffer;
    try {
      data = await readFile(absolute as string);
    } catch {
      return missingFromDisk();
    }
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': file.mimeType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'Content-Length': String(data.length),
        'Cache-Control': 'no-store',
      },
    });
  }

  const archiveName = `${safeEntryName(route)}.zip`;
  return new Response(
    zipStream(
      resolved.map(({ file, absolute }) => ({
        name: file.fileName,
        path: absolute as string,
      })),
    ),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(archiveName)}`,
        // The archive is built as it streams, so its length is not known up
        // front — chunked transfer it is.
        'Cache-Control': 'no-store',
      },
    },
  );
}

function missingFromDisk(): Response {
  return new Response(
    'The file is no longer available on this server. V1 stores uploads on the local filesystem, which can be ephemeral (e.g. /tmp on Vercel).',
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  );
}
