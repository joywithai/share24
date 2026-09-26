import { readFile } from 'node:fs/promises';

import { downloadFailure } from '@/lib/download-error';
import { DOWNLOAD_SCOPE_ALL } from '@/lib/download-token';
import { authorizeDownload } from '@/lib/downloads';
import { keepAvailable, resolveStoredPath } from '@/lib/storage';
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

  const access = await authorizeDownload(request, route, {
    scope: DOWNLOAD_SCOPE_ALL,
    token: new URL(request.url).searchParams.get('k'),
  });
  if (!access.ok) return access.response;

  // Metadata can outlive the bytes (a wiped uploads folder, an ephemeral disk),
  // so only the files that are really there go into the answer: a ZIP of what
  // is left beats a corrupt archive, and nothing left is an explained page.
  const present = await keepAvailable(access.files);
  if (present.length === 0) {
    return downloadFailure('files-gone', {
      route: access.route,
      missing: access.files.length,
    });
  }

  // Never trust the stored paths — each must resolve inside the uploads root.
  const resolved = present.map((file) => ({
    file,
    absolute: resolveStoredPath(file.storedPath),
  }));
  if (resolved.some((entry) => entry.absolute === null)) {
    return downloadFailure('corrupt', { route: access.route });
  }

  if (resolved.length === 1) {
    const [{ file, absolute }] = resolved;
    let data: Buffer;
    try {
      data = await readFile(absolute as string);
    } catch {
      return missingFromDisk(access.route);
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

function missingFromDisk(route: string): Response {
  return downloadFailure('file-gone', { route });
}
