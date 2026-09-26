import { readFile } from 'node:fs/promises';

import { downloadFailure } from '@/lib/download-error';
import { authorizeDownload } from '@/lib/downloads';
import { resolveStoredPath } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * /<route>/download/<fileId> — one file out of a multi-file share.
 *
 * The file must belong to the share addressed by the route, so an id from
 * another share can never be fetched through this route.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ route: string; fileId: string }> },
) {
  const { route, fileId } = await context.params;

  const access = await authorizeDownload(request, route, {
    scope: fileId,
    token: new URL(request.url).searchParams.get('k'),
  });
  if (!access.ok) return access.response;

  const file = access.files.find((entry) => entry.id === fileId);
  if (!file) {
    return downloadFailure('not-part-of-share', { route: access.route });
  }

  const absolute = resolveStoredPath(file.storedPath);
  if (!absolute) {
    return downloadFailure('corrupt', { route: access.route });
  }

  let data: Buffer;
  try {
    data = await readFile(absolute);
  } catch {
    return downloadFailure('file-gone', { route: access.route });
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
