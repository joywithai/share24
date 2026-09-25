'use client';

import { useCallback, useRef, useState } from 'react';

import { formatBytes } from '@/lib/file';
import { cn } from '@/lib/utils';

interface FileDropProps {
  file: File | null;
  onFile: (file: File | null) => void;
  /** Validation error from the parent (client-side, instant). */
  error?: string | null;
}

/**
 * Drag-and-drop (or click-to-browse) file picker. Purely presentational —
 * validation happens in the parent so the same rules apply server-side.
 */
export function FileDrop({ file, onFile, error }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      onFile(files?.[0] ?? null);
    },
    [onFile],
  );

  function onDrop(event: React.DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    handleFiles(event.dataTransfer.files);
  }

  if (file) {
    return (
      <div className="rounded-lg border border-line bg-bg p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="h-5 w-5"
              >
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <path
                  d="M14 3v5h5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" title={file.name}>
                {file.name}
              </p>
              <p className="text-xs text-sub">{formatBytes(file.size)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onFile(null)}
            className="shrink-0 text-xs text-sub underline-offset-2 hover:text-fg hover:underline"
          >
            Remove
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label="Choose a file to share"
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center transition-colors',
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
        Drop a file here, or click to browse
      </p>
      <p className="mt-1 text-xs text-sub">
        Any single file · max 10 MB · no archives, executables or media
      </p>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.doc,.docx"
        // Stop the (programmatic) input click bubbling back into the button,
        // which would re-trigger the file dialog.
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = '';
        }}
      />
    </button>
  );
}
