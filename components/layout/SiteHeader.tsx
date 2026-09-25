import Link from 'next/link';
import { AuthNav } from '@/components/layout/AuthNav';
import { Brand } from '@/components/layout/Brand';

/**
 * Static site chrome — the session-dependent part lives in the small client
 * component `AuthNav` so pages (especially the homepage) can stay static.
 */
export function SiteHeader() {
  return (
    <header className="flex items-center justify-between gap-3 py-5">
      <Link href="/" aria-label="Sharetofnd — home">
        <Brand />
      </Link>
      <AuthNav />
    </header>
  );
}
