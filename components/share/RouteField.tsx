'use client';

import {
  type ChangeEvent,
  type InputHTMLAttributes,
  useEffect,
  useState,
} from 'react';

import { compactHost } from '@/lib/utils';

export type RouteAvailability = 'idle' | 'checking' | 'free' | 'taken';

interface RouteFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  /** Live availability of the slug, checked by the parent on each keystroke. */
  availability?: RouteAvailability;
  /** Fired with the raw value on every change (parent debounces the check). */
  onValueChange?: (value: string) => void;
}

function StatusIcon({ availability }: { availability: RouteAvailability }) {
  if (availability === 'checking') {
    return (
      <output
        aria-label="Checking route…"
        className="h-4 w-4 animate-spin rounded-full border-2 border-sub/40 border-t-accent"
      />
    );
  }
  if (availability === 'free') {
    return (
      <svg
        aria-label="Route is available"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        className="h-4 w-4 text-ok"
      >
        <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (availability === 'taken') {
    return (
      <svg
        aria-label="Route is already taken"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        className="h-4 w-4 text-danger"
      >
        <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
      </svg>
    );
  }
  return null;
}

/**
 * The slug input, shown as the link it will become: the live origin as a
 * prefix chip, then the editable name — with a live ✓ / ✕ availability
 * indicator on every keystroke.
 *
 * A long host (a preview or staging domain, say) is trimmed from the *left*
 * with a real ellipsis instead of being sliced mid-letter, and the field is
 * laid out like the homepage "open by name" box: one rounded shell, an inset
 * chip for the part you cannot edit, and the editable part sitting inside it.
 */
export function RouteField({
  id,
  availability = 'idle',
  onValueChange,
  onChange,
  className,
  ...props
}: RouteFieldProps) {
  const [origin, setOrigin] = useState('https://sharetofnd');

  useEffect(() => {
    setOrigin(window.location.origin.replace(/^https?:\/\//, ''));
  }, []);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange?.(event);
    onValueChange?.(event.target.value);
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-1 rounded-xl border border-line bg-bg p-1 shadow-sm transition-colors focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/30">
      <span
        aria-hidden
        title={`${origin}/`}
        className="flex h-9 max-w-[40%] shrink-0 items-center overflow-hidden rounded-lg bg-card-soft px-2.5 font-mono text-[11px] text-sub"
      >
        {/* A long host is shortened to its tail (`…arena.site`), so the room
            goes to the name the visitor is actually choosing. If even that
            overflows, the ellipsis lands on the left (rtl) rather than slicing
            a word in half. */}
        <span
          className="whitespace-nowrap"
          style={{ direction: 'rtl', unicodeBidi: 'plaintext' }}
        >
          {compactHost(origin)}/
        </span>
      </span>
      <span className="relative flex min-w-0 flex-1 items-center">
        <input
          id={id}
          onChange={handleChange}
          className="h-9 w-full min-w-0 bg-transparent pr-8 pl-2 font-mono text-sm text-fg placeholder:text-sub/60 focus:outline-none"
          {...props}
        />
        <span className="pointer-events-none absolute right-2 flex items-center">
          <StatusIcon availability={availability} />
        </span>
      </span>
    </div>
  );
}
