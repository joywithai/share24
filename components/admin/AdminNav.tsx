'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The admin sidebar. A client component only because the active item needs
 * `usePathname`; everything it renders is static markup.
 */

const ITEMS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/search', label: 'Search' },
  { href: '/admin/shares', label: 'Shares' },
  { href: '/admin/files', label: 'Files' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/security', label: 'Security' },
  { href: '/admin/storage', label: 'Storage' },
  { href: '/admin/logs', label: 'Logs' },
  { href: '/admin/settings', label: 'Settings' },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin sections"
      className="flex flex-wrap gap-1 lg:flex-col lg:gap-0.5"
    >
      {ITEMS.map((item) => {
        const active =
          item.href === '/admin'
            ? pathname === '/admin'
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? 'bg-accent/15 font-medium text-accent'
                : 'text-sub hover:bg-card-soft hover:text-fg'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
