'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { type RecentSlug, readRecentSlugs } from '@/lib/recent-slugs';
import { cn } from '@/lib/utils';

/** One press of an arrow moves roughly four fifths of the visible strip. */
const STEP_RATIO = 0.8;
/** How long the "Copied" state stays on a chip. */
const FEEDBACK_MS = 1600;

/**
 * Copies text, preferring the async Clipboard API and falling back to a
 * throwaway textarea for browsers/contexts where it is unavailable (older
 * Safari, non-secure origins).
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function CopyIcon({ done }: { done: boolean }) {
  if (done) {
    return (
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        className="h-3.5 w-3.5"
      >
        <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
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
      className="h-3.5 w-3.5"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path
        d="M15 5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowButton({
  direction,
  disabled,
  onClick,
}: {
  direction: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={
        direction === 'left' ? 'Scroll slugs left' : 'Scroll slugs right'
      }
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-card text-sub transition-colors',
        'hover:border-accent/50 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-sub',
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        className="h-3.5 w-3.5"
      >
        <path
          d={direction === 'left' ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6'}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/**
 * The names this browser created, as a strip of chips. Clicking one copies its
 * link — the whole point is to paste it somewhere right after creating a share.
 * Arrows appear once the strip actually overflows. Renders nothing at all for a
 * visitor who has not created anything yet.
 */
export function RecentSlugs() {
  const [entries, setEntries] = useState<RecentSlug[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read after mount: the server has no sessionStorage, so rendering it during
  // SSR would only produce a hydration mismatch.
  useEffect(() => {
    setEntries(readRecentSlugs());
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const measure = useCallback(() => {
    const element = scrollerRef.current;
    if (!element) return;
    const max = element.scrollWidth - element.clientWidth;
    setEdges({
      start: element.scrollLeft > 4,
      end: max > 4 && element.scrollLeft < max - 4,
    });
  }, []);

  useEffect(() => {
    // A new chip changes the strip's width, so re-measure whenever the list
    // changes (the observer alone would not notice: the container's own size
    // stays the same while its content grows).
    if (entries.length === 0) return;
    measure();
    const element = scrollerRef.current;
    if (!element) return;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => measure());
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, entries]);

  function scrollByStep(direction: -1 | 1) {
    const element = scrollerRef.current;
    if (!element) return;
    element.scrollBy({
      left: direction * element.clientWidth * STEP_RATIO,
      behavior: 'smooth',
    });
  }

  async function handleCopy(slug: string) {
    const url = `${window.location.origin}/${slug}`;
    const ok = await copyText(url);
    if (timerRef.current) clearTimeout(timerRef.current);
    setCopied(ok ? slug : null);
    setFailed(ok ? null : slug);
    timerRef.current = setTimeout(() => {
      setCopied(null);
      setFailed(null);
    }, FEEDBACK_MS);
  }

  if (entries.length === 0) return null;

  const overflowing = edges.start || edges.end;

  return (
    <section className="mt-5 w-full max-w-md text-left">
      <div className="flex items-end justify-between gap-3 pl-1">
        <p className="text-xs font-medium text-sub">
          Your slugs{' '}
          <span className="font-normal text-sub/60">· tap one to copy</span>
        </p>
        {overflowing && (
          <div className="flex shrink-0 items-center gap-1">
            <ArrowButton
              direction="left"
              disabled={!edges.start}
              onClick={() => scrollByStep(-1)}
            />
            <ArrowButton
              direction="right"
              disabled={!edges.end}
              onClick={() => scrollByStep(1)}
            />
          </div>
        )}
      </div>

      <div
        ref={scrollerRef}
        onScroll={measure}
        data-testid="recent-slugs-scroller"
        className="mt-2 flex snap-x gap-2 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {entries.map((entry, index) => {
          const isCopied = copied === entry.slug;
          const isFailed = failed === entry.slug;
          return (
            <button
              key={entry.slug}
              type="button"
              onClick={() => handleCopy(entry.slug)}
              title={`Copy a link to /${entry.slug}`}
              aria-label={`Copy a link to /${entry.slug}`}
              style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
              className={cn(
                'slug-chip group flex shrink-0 snap-start items-center gap-2 rounded-xl border px-3 py-2 font-mono text-xs transition-all',
                'hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20 active:translate-y-0',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                isCopied
                  ? 'border-ok/50 bg-ok/10 text-ok'
                  : isFailed
                    ? 'border-danger/50 bg-danger/10 text-danger'
                    : 'border-line bg-card text-fg hover:border-accent/50 hover:bg-card-soft',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'font-semibold',
                  isCopied || isFailed ? 'opacity-70' : 'text-accent',
                )}
              >
                /
              </span>
              <span className="max-w-[10rem] truncate">{entry.slug}</span>
              <span
                aria-hidden
                className={cn(
                  'transition-colors',
                  isCopied || isFailed
                    ? 'opacity-100'
                    : 'text-sub/60 group-hover:text-accent',
                )}
              >
                <CopyIcon done={isCopied} />
              </span>
              <span className="sr-only">
                {isCopied ? 'Copied' : isFailed ? 'Copy failed' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
