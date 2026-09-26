import { currentAdmin } from '@/lib/admin';
import { downloadFailure } from '@/lib/download-error';
import { type DownloadScope, isValidDownloadToken } from '@/lib/download-token';
import { isShareExpired } from '@/lib/expire';
import {
  isValidUnlockToken,
  parseCookieHeader,
  unlockCookieName,
} from '@/lib/pin';
import { prisma } from '@/lib/prisma';
import { guardAction } from '@/lib/security/guard';
import { clientIp } from '@/lib/security/ip';
import { maintenanceState } from '@/lib/settings';
import type { StorageFileRef } from '@/lib/storage/types';

/**
 * Shared gate for every file download of a share.
 *
 * `/<route>/download` (the whole set) and `/<route>/download/<fileId>` (one
 * file) must answer the same questions — does the share exist, is it still
 * alive, is the PIN satisfied — so the checks live here once and both routes
 * only deal with serving bytes.
 */

/**
 * One downloadable file: the storage columns decide *which* provider serves it,
 * the rest is what the response headers need.
 */
/**
 * Rate limit + block-list check for a download, before any database work.
 * Returns a ready-to-send page, or `null` when the request may continue.
 */
export async function downloadGuard(
  request: Request,
  route: string,
): Promise<Response | null> {
  const outcome = await guardAction('download', {
    ip: clientIp(request.headers),
    route,
    userAgent: request.headers.get('user-agent'),
  });
  if (outcome.ok) {
    // Maintenance mode stops downloads for visitors; the admin panel — and
    // therefore the ability to test and to turn it off — keeps working.
    const state = await maintenanceState();
    if (state.active && !(await currentAdmin())) {
      return downloadFailure('maintenance', { route });
    }
    return null;
  }

  return outcome.status === 429
    ? downloadFailure('rate-limited', {
        route,
        retryAfterSeconds: outcome.retryAfterSeconds,
      })
    : downloadFailure('blocked', { route });
}

export interface DownloadableFile extends StorageFileRef {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  position: number;
}

export type DownloadAccess =
  | { ok: true; route: string; files: DownloadableFile[] }
  | { ok: false; response: Response };

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
    return { ok: false, response: downloadFailure('share-gone', { route }) };
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
    return { ok: false, response: downloadFailure('corrupt', { route }) };
  }

  return { ok: true, route: share.route, files: share.files };
}
