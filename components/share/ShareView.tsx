import { CodeViewer } from '@/components/share/CodeViewer';
import { CopyButton } from '@/components/share/CopyButton';
import { DownloadAutoStart } from '@/components/share/DownloadAutoStart';
import { ExpiryCountdown } from '@/components/share/ExpiryCountdown';
import { formatBytes } from '@/lib/file';

export interface SharedFileMeta {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
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

  if (files.length === 1) {
    const [file] = files;
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
          <a
            href={downloadHref(route, ALL_FILES, tokens)}
            data-download-key={ALL_FILES}
            className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-soft"
          >
            {downloadIcon('h-4 w-4')}
            Download
          </a>
        </div>
        <p className="mt-4 text-xs text-sub/70">
          Files are stored on this server and vanish with the share — download
          them before the countdown ends.
        </p>
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
            Take them one by one, or grab the whole set in one ZIP.
          </p>
        </div>
        <a
          href={downloadHref(route, ALL_FILES, tokens)}
          data-download-key={ALL_FILES}
          className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-soft"
        >
          {downloadIcon('h-4 w-4')}
          Download all (.zip)
        </a>
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
              <p className="truncate text-sm font-medium" title={file.fileName}>
                {file.fileName}
              </p>
              <p className="text-xs text-sub">
                {formatBytes(file.fileSize)} · {file.mimeType}
              </p>
            </div>
            <a
              href={downloadHref(route, file.id, tokens)}
              data-download-key={file.id}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-transparent px-3 text-xs font-medium text-fg transition-colors hover:bg-card hover:border-accent/50"
            >
              {downloadIcon('h-3.5 w-3.5')}
              Download
            </a>
          </li>
        ))}
      </ul>

      <p className="border-t border-line p-4 text-xs text-sub/70">
        Files are stored on this server and vanish with the share — download
        them before the countdown ends.
      </p>
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
