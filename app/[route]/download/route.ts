import { downloadFailure } from '@/lib/download-error';
import { DOWNLOAD_SCOPE_ALL } from '@/lib/download-token';
import { authorizeDownload, downloadGuard } from '@/lib/downloads';
import {
  availableFiles,
  getStorageProvider,
  providerFor,
  resolveStoredPath,
  type StorageFileRef,
} from '@/lib/storage';
import {
  safeEntryName,
  type ZipEntry,
  type ZipSource,
  zipStream,
} from '@/lib/zip';

export const dynamic = 'force-dynamic';

/**
 * /<route>/download — the whole share.
 *
 * One file: served as itself (so single-file links keep working exactly as
 * before). Several files: bundled into one ZIP, streamed as it is built — handy
 * when somebody shared ten screenshots under one name.
 *
 * The bytes come from whichever storage provider each row belongs to, so a
 * share uploaded before the switch to R2 still downloads from the disk.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ route: string }> },
) {
  const { route } = await context.params;

  // Block list and rate limit first — nothing below touches the database for
  // an address that is hammering the route.
  const limited = await downloadGuard(request, route);
  if (limited) return limited;

  const access = await authorizeDownload(request, route, {
    scope: DOWNLOAD_SCOPE_ALL,
    token: new URL(request.url).searchParams.get('k'),
  });
  if (!access.ok) return access.response;

  // Metadata can outlive the bytes (a wiped uploads folder, deleted objects),
  // so only the files that are really there go into the answer: a ZIP of what
  // is left beats a corrupt archive, and nothing left is an explained page.
  const present = await availableFiles(access.files);
  if (present.length === 0) {
    return downloadFailure('files-gone', {
      route: access.route,
      missing: access.files.length,
    });
  }

  if (present.length === 1) {
    return singleFile(access.route, present[0]);
  }

  // Never trust the stored locations — each one is validated by its provider.
  let entries: ZipEntry[];
  try {
    entries = present.map((file) => ({
      name: file.fileName,
      source: zipSourceFor(file),
    }));
  } catch (error) {
    console.error(`[download] ${access.route} has an unusable location`, error);
    return downloadFailure('corrupt', { route: access.route });
  }

  const archiveName = `${safeEntryName(access.route)}.zip`;
  return new Response(zipStream(entries), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(archiveName)}`,
      // The archive is built as it streams, so its length is not known up
      // front — chunked transfer it is.
      'Cache-Control': 'no-store',
    },
  });
}

async function singleFile(
  route: string,
  file: StorageFileRef & { fileName: string; mimeType: string },
): Promise<Response> {
  let data: Uint8Array | null;
  try {
    data = await providerFor(file).get(file);
  } catch (error) {
    console.error(`[download] ${route} could not be read`, error);
    return downloadFailure('corrupt', { route });
  }

  if (!data) return downloadFailure('file-gone', { route });

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

/**
 * Where one entry of the archive comes from. Local files are read from the disk
 * as the archive streams; anything remote is fetched through its provider while
 * the archive is being written, one file at a time.
 */
function zipSourceFor(file: StorageFileRef): ZipSource {
  if (file.storageType === 'LOCAL') {
    const absolute = resolveStoredPath(file.storedPath);
    if (!absolute) {
      throw new Error(
        `stored path escapes the uploads root: ${file.storedPath}`,
      );
    }
    return { kind: 'path', path: absolute };
  }

  const provider = getStorageProvider('R2');
  return { kind: 'remote', load: () => provider.get(file) };
}
