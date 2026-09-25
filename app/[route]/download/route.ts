import { readFile } from 'node:fs/promises';

import { isShareExpired } from '@/lib/expire';
import {
  isValidUnlockToken,
  parseCookieHeader,
  unlockCookieName,
} from '@/lib/pin';
import { prisma } from '@/lib/prisma';
import { resolveStoredPath } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * /<route>/download — serves the stored file of a file-share.
 *
 * Checks: share exists and is a live file share → PIN unlock cookie (if
 * protected) → file still present on disk (V1 local storage can be
 * ephemeral, so a polite 410 is possible).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ route: string }> },
) {
  const { route } = await context.params;

  const share = await prisma.share.findFirst({
    where: { route, type: 'file' },
    orderBy: { createdAt: 'desc' },
    include: { file: true },
  });

  if (!share || isShareExpired(share)) {
    return new Response('This share no longer exists.', { status: 410 });
  }

  if (share.pinHash) {
    const cookieHeader = request.headers.get('cookie') ?? '';
    const token = parseCookieHeader(cookieHeader).get(unlockCookieName(route));
    if (!token || !isValidUnlockToken(token, route)) {
      // A *relative* Location on purpose: behind a TLS-terminating proxy
      // (sandbox previews, Vercel) `request.url` is the internal `http://`
      // URL, so an absolute redirect would send the browser to a scheme the
      // public host does not serve. Relative resolves against the origin the
      // browser actually used.
      return new Response(null, {
        status: 303,
        headers: { Location: `/${route}`, 'Cache-Control': 'no-store' },
      });
    }
  }

  if (!share.file || !share.fileUrl) {
    return new Response('File metadata is missing for this share.', {
      status: 500,
    });
  }

  // Never trust the stored path — it must resolve inside the uploads root.
  const absolute = resolveStoredPath(share.fileUrl);
  if (!absolute) {
    return new Response('Invalid file reference.', { status: 500 });
  }

  let data: Buffer;
  try {
    data = await readFile(absolute);
  } catch {
    return new Response(
      'The file is no longer available on this server. V1 stores uploads on the local filesystem, which can be ephemeral (e.g. /tmp on Vercel).',
      { status: 410 },
    );
  }

  const fileName = share.file.fileName;
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': share.file.mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Content-Length': String(data.length),
      'Cache-Control': 'no-store',
    },
  });
}
