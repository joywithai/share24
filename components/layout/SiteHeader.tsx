import Link from 'next/link';

import { AuthNav } from '@/components/layout/AuthNav';

/**
 * Static site chrome — the session-dependent part lives in the small client
 * component `AuthNav` so pages (especially the homepage) can stay static.
 */
export function SiteHeader() {
  return (
    <header className="flex items-center justify-between py-5">
      <Link
        href="/"
        className="flex items-baseline gap-1.5 font-mono text-lg font-semibold tracking-tight text-fg"
      >
        <span className="text-accent">corium</span>
        <span className="text-xs font-normal text-sub">24h</span>
      </Link>
      <AuthNav />
    </header>
  );
}
