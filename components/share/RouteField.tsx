'use client';

import { type InputHTMLAttributes, useEffect, useState } from 'react';

interface RouteFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
}

/**
 * The slug input, shown as the link it will become: the live origin as a
 * fixed prefix box, then the editable name — so it is obvious at a glance
 * that “any-name” *is* the share link.
 */
export function RouteField({ id, className, ...props }: RouteFieldProps) {
  const [origin, setOrigin] = useState('https://sharetofnd');

  useEffect(() => {
    setOrigin(window.location.origin.replace(/^https?:\/\//, ''));
  }, []);

  return (
    <div className="flex w-full min-w-0 items-stretch overflow-hidden rounded-md border border-line bg-card transition-colors focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/30">
      <span
        aria-hidden
        className="flex max-w-[60%] shrink-0 items-center truncate border-r border-line bg-card-soft px-2.5 font-mono text-xs text-sub sm:text-sm"
      >
        {origin}/
      </span>
      <input
        id={id}
        className="h-10 w-full min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-fg placeholder:text-sub/60 focus:outline-none"
        {...props}
      />
    </div>
  );
}
