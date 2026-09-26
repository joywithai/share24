import { CodeViewer } from '@/components/share/CodeViewer';
import { CopyButton } from '@/components/share/CopyButton';
import { DownloadAutoStart } from '@/components/share/DownloadAutoStart';
import { DownloadLink } from '@/components/share/DownloadLink';
import { ExpiryCountdown } from '@/components/share/ExpiryCountdown';
import { PreviewDownloadHint } from '@/components/share/PreviewDownloadHint';
import { formatBytes } from '@/lib/file';

export interface SharedFileMeta {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  /**
   * `false` when the bytes are already gone from the server (the row survived
   * a wiped uploads folder). The list then says so instead of offering a
   * button that ends on an error page. Undefined means "assume it is there".
   */
  available?: boolean;
}

export interface ShareViewProps {
  route: string;
  type: 'code' | 'file';
  content: string;
  createdAt: string;
  expiresAt: string;
  /** Every file of a `file` share, in the order the author picked them. */
  files?: SharedFileMeta[];
  /**
   * Signed download tokens, minted because this page only renders for someone
   * who already has access (see lib/download-token.ts).
   */
  downloadTokens?: Record<string, string>;
  /**
   * `?download=all|<fileId>` — set when a download bounced off the PIN gate.
   * The matching link is clicked as soon as this page renders.
   */
  downloadIntent?: string;
}

function fileIcon(mimeType: string, size = 'h-7 w-7') {
  if (mimeType.startsWith('image/')) {
    return (
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className={size}
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="1.6" />
        <path
          d="m4 18 5-5 3 3 4-4 4 4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={size}
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The `?k=` token that stands in for the unlock cookie on download links. */
const ALL_FILES = 'all';

function downloadHref(
  route: string,
  scope: string,
  tokens: Record<string, string>,
): string {
  const base =
    scope === ALL_FILES ? `/${route}/download` : `/${route}/download/${scope}`;
  const token = tokens[scope];
  return token ? `${base}?k=${encodeURIComponent(token)}` : base;
}

function downloadIcon(className: string) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
    >
      <path
        d="M12 4v12m0 0 4-4m-4 4-4-4M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Nothing left to hand over: every file of the share was removed from the disk
 * before the share itself expired. Says so plainly and offers the way out.
 */
function GonePanel({ route, count }: { route: string; count: number }) {
  return (
    <div
      data-testid="files-gone-panel"
      className="rounded-xl border border-line bg-card p-6 text-center"
    >
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6"
        >
          <path d="M12 8v5" />
          <path d="M12 16.5h.01" />
          <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
      </span>
      <h2 className="mt-4 text-base font-semibold">
        {count === 1
          ? 'This file is no longer on the server'
          : 'These files are no longer on the server'}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-sub">
        The share <span className="font-mono text-fg">/{route}</span> still
        exists, but its {count === 1 ? 'file was' : `${count} files were`}{' '}
        removed from disk before the 24 hours ran out — uploads are stored on
        this server, and a restart can empty that storage.
      </p>
      <a
        href="/create/file"
        className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-soft"
      >
        Share files again
      </a>
    </div>
  );
}

/**
 * The files of a share: one row each (download it on its own) plus a ZIP of the
 * whole set when there is more than one. A single file keeps the plain
 * "Download" button it always had — and the same `/<route>/download` URL, so
 * links people already hold keep working.
 */
function SharedFileList({
  route,
  files,
  tokens,
}: {
  route: string;
  files: SharedFileMeta[];
  tokens: Record<string, string>;
}) {
  const total = files.reduce((sum, file) => sum + file.fileSize, 0);
  const available = files.filter((file) => file.available !== false);
  const missingCount = files.length - available.length;

  // Nothing left on disk: no ZIP button, no rows of dead links — just the
  // reason and a way to start over.
  if (available.length === 0) {
    return <GonePanel route={route} count={files.length} />;
  }

  if (files.length === 1) {
    const [file] = files;
    if (file.available === false) {
      return <GonePanel route={route} count={1} />;
    }
    return (
      <div className="rounded-xl border border-line bg-card p-6">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            {fileIcon(file.mimeType)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={file.fileName}>
              {file.fileName}
            </p>
            <p className="mt-0.5 text-xs text-sub">
              {formatBytes(file.fileSize)} · {file.mimeType}
            </p>
          </div>
          <DownloadLink
            href={downloadHref(route, ALL_FILES, tokens)}
            downloadKey={ALL_FILES}
            className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-soft"
          >
            {downloadIcon('h-4 w-4')}
            Download
          </DownloadLink>
        </div>
        <p className="mt-4 text-xs text-sub/70">
          Files are stored on this server and vanish with the share — download
          them before the countdown ends.
        </p>
        <PreviewDownloadHint />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
        <div>
          <p className="text-sm font-semibold">
            {files.length} files · {formatBytes(total)}
          </p>
          <p className="mt-0.5 text-xs text-sub">
            {missingCount > 0
              ? `${missingCount} of ${files.length} files are already gone from the server.`
              : 'Take them one by one, or grab the whole set in one ZIP.'}
          </p>
        </div>
        <DownloadLink
          href={downloadHref(route, ALL_FILES, tokens)}
          downloadKey={ALL_FILES}
          className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-soft"
        >
          {downloadIcon('h-4 w-4')}
          {missingCount > 0
            ? 'Download the rest (.zip)'
            : 'Download all (.zip)'}
        </DownloadLink>
      </div>

      <ul className="divide-y divide-line">
        {files.map((file) => (
          <li
            key={file.id}
            className="flex items-center gap-3 p-3 transition-colors hover:bg-card-soft"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              {fileIcon(file.mimeType, 'h-5 w-5')}
            </span>
            <div className="min-w-0 flex-1">
              {file.available === false ? (
                <p
                  className="truncate text-sm font-medium text-sub"
                  title={file.fileName}
                >
                  {file.fileName}
                </p>
              ) : (
                /* The name is the obvious thing to click — let it download
                   the file as well, instead of doing nothing at all. */
                <DownloadLink
                  href={downloadHref(route, file.id, tokens)}
                  downloadKey={file.id}
                  title={file.fileName}
                  className="block truncate text-sm font-medium transition-colors hover:text-accent hover:underline"
                >
                  {file.fileName}
                </DownloadLink>
              )}
              <p className="text-xs text-sub">
                {formatBytes(file.fileSize)} · {file.mimeType}
                {file.available === false && (
                  <span className="text-danger">
                    {' '}
                    · no longer on the server
                  </span>
                )}
              </p>
            </div>
            {file.available === false ? (
              <span className="inline-flex h-9 shrink-0 items-center rounded-md border border-line/60 px-3 text-xs font-medium text-sub/60">
                Gone
              </span>
            ) : (
              <DownloadLink
                href={downloadHref(route, file.id, tokens)}
                downloadKey={file.id}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-transparent px-3 text-xs font-medium text-fg transition-colors hover:bg-card hover:border-accent/50"
              >
                {downloadIcon('h-3.5 w-3.5')}
                Download
              </DownloadLink>
            )}
          </li>
        ))}
      </ul>

      <div className="border-t border-line p-4">
        <p className="text-xs text-sub/70">
          Files are stored on this server and vanish with the share — download
          them before the countdown ends.
        </p>
        <PreviewDownloadHint />
      </div>
    </div>
  );
}

/**
 * The public view of a live, (possibly PIN-unlocked) share — rendered by the
 * `[route]` server component after all server-side checks passed.
 */
export function ShareView({
  route,
  type,
  content,
  createdAt,
  expiresAt,
  files,
  downloadTokens = {},
  downloadIntent = '',
}: ShareViewProps) {
  const created = new Date(createdAt);

  return (
    <div className="space-y-6">
      {/* A download that bounced off the PIN gate resumes here. */}
      <DownloadAutoStart scope={downloadIntent} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-mono text-lg font-semibold text-accent">
            /{route}
          </h1>
          <p className="mt-0.5 text-xs text-sub">
            Shared {created.toLocaleString()} ·{' '}
            <ExpiryCountdown expiresAt={expiresAt} />
          </p>
        </div>
        <CopyButton />
      </div>

      {type === 'code' ? (
        <CodeViewer value={content} />
      ) : (
        files &&
        files.length > 0 && (
          <SharedFileList route={route} files={files} tokens={downloadTokens} />
        )
      )}
    </div>
  );
}
