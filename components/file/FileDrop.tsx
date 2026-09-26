'use client';

import { useCallback, useRef, useState } from 'react';

import { formatBytes, MAX_FILES_PER_SHARE } from '@/lib/file';
import { cn } from '@/lib/utils';

interface FileDropProps {
  files: File[];
  onFiles: (files: File[]) => void;
  /** Validation error from the parent (client-side, instant). */
  error?: string | null;
}

/** Identifies a picked file so the same one is not added twice. */
function sameFile(a: File, b: File): boolean {
  return (
    a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
  );
}

/**
 * Drag-and-drop (or click-to-browse) file picker for a whole *set* of files:
 * pick or drop several at once, or add them one after another — up to
 * `MAX_FILES_PER_SHARE`, each removable on its own. Purely presentational —
 * validation happens in the parent so the same rules apply server-side.
 */
export function FileDrop({ files, onFiles, error }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const currentRef = useRef(files);
  currentRef.current = files;
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback(
    (incoming: FileList | File[] | null) => {
      const list = Array.from(incoming ?? []);
      if (list.length === 0) return;
      const seen = currentRef.current;
      const next = [...seen];
      for (const file of list) {
        if (next.some((existing) => sameFile(existing, file))) continue;
        next.push(file);
      }
      onFiles(next);
    },
    [onFiles],
  );

  function onDrop(event: React.DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  const total = files.reduce((sum, file) => sum + file.size, 0);
  const full = files.length >= MAX_FILES_PER_SHARE;

  return (
    <div className="space-y-3">
      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file) => (
            <li
              key={`${file.name}-${file.size}-${file.lastModified}`}
              className="flex items-center gap-3 rounded-lg border border-line bg-bg p-3"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-4.5 w-4.5"
                >
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path
                    d="M14 3v5h5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={file.name}>
                  {file.name}
                </p>
                <p className="text-xs text-sub">{formatBytes(file.size)}</p>
              </div>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() =>
                  onFiles(currentRef.current.filter((entry) => entry !== file))
                }
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sub transition-colors hover:bg-card hover:text-danger"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-4 w-4"
                >
                  <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        aria-label="Choose files to share"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 text-center transition-colors',
          files.length > 0 ? 'py-6' : 'py-12',
          dragging
            ? 'border-accent bg-accent/5'
            : 'border-line bg-bg hover:border-sub/50',
        )}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-card text-accent">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-6 w-6"
          >
            <path
              d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <p className="mt-4 text-sm font-medium">
          {files.length === 0
            ? 'Drop files here, or click to browse'
            : full
              ? `${MAX_FILES_PER_SHARE} files is the limit for one share`
              : 'Add more files'}
        </p>
        <p className="mt-1 text-xs text-sub">
          {files.length > 0
            ? `${files.length} of ${MAX_FILES_PER_SHARE} files · ${formatBytes(total)} of 50 MB`
            : '1–10 files per share · max 10 MB each · no archives, executables or media'}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          // Validation happens in the parent; accepting everything here means
          // a blocked file gets a clear message instead of a silent no-op.
          // Stop the (programmatic) input click bubbling back into the button,
          // which would re-trigger the file dialog.
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </button>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
