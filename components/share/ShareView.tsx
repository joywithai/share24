import { CodeBlock } from '@/components/share/CodeBlock';
import { CopyButton } from '@/components/share/CopyButton';
import { ExpiryCountdown } from '@/components/share/ExpiryCountdown';
import { formatBytes } from '@/lib/file';

export interface SharedFileMeta {
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
  file?: SharedFileMeta;
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) {
    return (
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-7 w-7"
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
      className="h-7 w-7"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
  file,
}: ShareViewProps) {
  const created = new Date(createdAt);

  return (
    <div className="space-y-6">
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
        <CodeBlock value={content} />
      ) : (
        file && (
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
                href={`/${route}/download`}
                className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-soft"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-4 w-4"
                >
                  <path
                    d="M12 4v12m0 0 4-4m-4 4-4-4M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Download
              </a>
            </div>
            <p className="mt-4 text-xs text-sub/70">
              Files are stored on this server and vanish with the share —
              download them before the countdown ends.
            </p>
          </div>
        )
      )}
    </div>
  );
}
