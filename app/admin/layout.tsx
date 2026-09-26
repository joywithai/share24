import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AdminNav } from '@/components/admin/AdminNav';
import { Brand } from '@/components/layout/Brand';
import { currentAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

/**
 * The admin shell.
 *
 * The middleware already bounced anonymous visitors to the login page; this is
 * the check that matters — the role is read from the database, and a signed-in
 * non-admin gets a 404 rather than a redirect, so the panel's existence is not
 * confirmed to them.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await currentAdmin();
  if (!admin) notFound();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-16">
      <header className="flex items-center justify-between gap-3 py-5">
        <Link href="/" aria-label="Sharetofnd — home">
          <Brand />
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <form action="/admin/search" className="hidden sm:block">
            <input
              name="q"
              placeholder="Search…"
              className="h-9 w-40 rounded-md border border-line bg-card-soft px-3 text-sm text-fg outline-none focus:border-accent"
            />
          </form>
          <span className="hidden text-sub lg:inline">{admin.email}</span>
          <Link
            href="/"
            className="rounded-md border border-line px-3 py-1.5 text-sub transition-colors hover:text-fg"
          >
            Back to the app
          </Link>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-6 lg:flex-row">
        <aside className="lg:w-48 lg:shrink-0">
          <AdminNav />
        </aside>
        <main className="min-w-0 flex-1 space-y-6">{children}</main>
      </div>
    </div>
  );
}
