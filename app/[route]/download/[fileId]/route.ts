import { readFile } from 'node:fs/promises';

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

  const access = await authorizeDownload(request, route);
  if (!access.ok) return access.response;

  const file = access.files.find((entry) => entry.id === fileId);
  if (!file) {
    return new Response('That file is not part of this share.', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const absolute = resolveStoredPath(file.storedPath);
  if (!absolute) {
    return new Response('Invalid file reference.', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  let data: Buffer;
  try {
    data = await readFile(absolute);
  } catch {
    return new Response(
      'The file is no longer available on this server. V1 stores uploads on the local filesystem, which can be ephemeral (e.g. /tmp on Vercel).',
      { status: 410, headers: { 'Cache-Control': 'no-store' } },
    );
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
