'use client';

import {
  type ChangeEvent,
  type InputHTMLAttributes,
  useEffect,
  useState,
} from 'react';

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
      <span
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
 * fixed prefix box (truncated from the *left* on narrow screens, so the
 * meaningful tail stays visible), then the editable name — with a live
 * ✓ / ✕ availability indicator on every keystroke.
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
    <div className="flex w-full min-w-0 items-stretch overflow-hidden rounded-md border border-line bg-card transition-colors focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/30">
      <span
        aria-hidden
        className="flex shrink items-center justify-end overflow-hidden border-r border-line bg-card-soft px-2.5 font-mono text-xs text-sub sm:text-sm"
        style={{ maxWidth: '55%' }}
      >
        <span className="whitespace-nowrap">{origin}/</span>
      </span>
      <span className="relative flex min-w-0 flex-1 items-center">
        <input
          id={id}
          onChange={handleChange}
          className="h-10 w-full min-w-0 bg-transparent px-3 pr-8 font-mono text-sm text-fg placeholder:text-sub/60 focus:outline-none"
          {...props}
        />
        <span className="pointer-events-none absolute right-2.5 flex items-center">
          <StatusIcon availability={availability} />
        </span>
      </span>
    </div>
  );
}
