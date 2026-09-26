import { type DownloadScope, isValidDownloadToken } from '@/lib/download-token';
import { isShareExpired } from '@/lib/expire';
import {
  isValidUnlockToken,
  parseCookieHeader,
  unlockCookieName,
} from '@/lib/pin';
import { prisma } from '@/lib/prisma';

/**
 * Shared gate for every file download of a share.
 *
 * `/<route>/download` (the whole set) and `/<route>/download/<fileId>` (one
 * file) must answer the same questions — does the share exist, is it still
 * alive, is the PIN satisfied — so the checks live here once and both routes
 * only deal with serving bytes.
 */

export interface DownloadableFile {
  id: string;
  storedPath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  position: number;
}

export type DownloadAccess =
  | { ok: true; route: string; files: DownloadableFile[] }
  | { ok: false; response: Response };

function gone(message: string, status = 410): Response {
  return new Response(message, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function authorizeDownload(
  request: Request,
  route: string,
  options: { scope: DownloadScope; token?: string | null } = { scope: 'all' },
): Promise<DownloadAccess> {
  const share = await prisma.share.findFirst({
    where: { route, type: 'file' },
    orderBy: { createdAt: 'desc' },
    include: { files: { orderBy: { position: 'asc' } } },
  });

  if (!share || isShareExpired(share)) {
    return { ok: false, response: gone('This share no longer exists.') };
  }

  if (share.pinHash) {
    const cookieHeader = request.headers.get('cookie') ?? '';
    const cookieToken = parseCookieHeader(cookieHeader).get(
      unlockCookieName(route),
    );
    const unlocked =
      Boolean(cookieToken && isValidUnlockToken(cookieToken, route)) ||
      // A signed link minted by the page that was already unlocked — see
      // lib/download-token.ts for why this exists.
      Boolean(
        options.token &&
          isValidDownloadToken(options.token, route, options.scope),
      );

    if (!unlocked) {
      // Back to the share page, *remembering* what was being downloaded, so
      // the PIN form can hand the file over right after a successful unlock
      // instead of making the visitor find the button again.
      //
      // A *relative* Location on purpose: behind a TLS-terminating proxy
      // (sandbox previews, Vercel) `request.url` is the internal `http://`
      // URL, so an absolute redirect would send the browser to a scheme the
      // public host does not serve. Relative resolves against the origin the
      // browser actually used.
      const back = `/${route}?download=${encodeURIComponent(options.scope)}`;
      return {
        ok: false,
        response: new Response(null, {
          status: 303,
          headers: { Location: back, 'Cache-Control': 'no-store' },
        }),
      };
    }
  }

  if (share.files.length === 0) {
    return {
      ok: false,
      response: gone('File metadata is missing for this share.', 500),
    };
  }

  return { ok: true, route: share.route, files: share.files };
}
