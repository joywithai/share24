'use client';

import { useRef, useState } from 'react';

import type { CodeEditorApi } from '@/components/editor/CodeEditor';
import { CodeBlock } from '@/components/share/CodeBlock';
import { CopyButton } from '@/components/share/CopyButton';
import { Button } from '@/components/ui/button';

interface MatchState {
  count: number;
  index: number;
}

/**
 * Shared-code viewer: the read-only editor plus a small toolbar with
 *  - one-click "Copy code" (the whole share, no selecting), and
 *  - a Find box that highlights every match and smooth-scrolls through them,
 *    first occurrence first (like an editor's search).
 */
export function CodeViewer({ value }: { value: string }) {
  const apiRef = useRef<CodeEditorApi | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<MatchState | null>(null);

  function startFind() {
    const q = query.trim();
    if (!q) {
      setMatches(null);
      apiRef.current?.clear();
      return;
    }
    setMatches(apiRef.current?.find(q) ?? null);
  }

  function findNext() {
    setMatches(apiRef.current?.next() ?? null);
  }

  function clearFind() {
    setQuery('');
    setMatches(null);
    apiRef.current?.clear();
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            startFind();
          }}
          className="flex min-w-0 flex-1 basis-52 items-center gap-2"
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') clearFind();
            }}
            placeholder="Find in this share…"
            aria-label="Find in this share"
            className="h-9 w-full min-w-0 flex-1 rounded-md border border-line bg-card px-3 font-mono text-xs text-fg placeholder:text-sub/60 focus-visible:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          />
          <Button type="submit" variant="outline" size="sm">
            Find
          </Button>
          {matches && matches.count > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={findNext}
              title="Jump to the next match"
            >
              Next
            </Button>
          )}
        </form>
        <CopyButton value={value} label="Copy code" copiedLabel="Copied!" />
      </div>

      {matches &&
        (matches.count > 0 ? (
          <p className="text-xs text-sub" aria-live="polite">
            <span className="font-mono text-brand-3">
              {matches.index + 1}/{matches.count}
            </span>{' '}
            match{matches.count === 1 ? '' : 'es'} for “{query.trim()}” — Next
            jumps to the following one.
          </p>
        ) : (
          <p className="text-xs text-danger" role="alert">
            No match for “{query.trim()}” in this share.
          </p>
        ))}

      <CodeBlock value={value} apiRef={apiRef} />
    </div>
  );
}
