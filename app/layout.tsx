import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { SiteHeader } from '@/components/layout/SiteHeader';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Corium',
    template: '%s · Corium',
  },
  description:
    'Share code or files with a link that self-destructs after 24 hours. No account, no forms — just a route and a link.',
};

export const viewport: Viewport = {
  themeColor: '#0b0d0f',
};

/**
 * Root layout — enforces the Corium layout constraint once for every page:
 * max-width 1000px, centered, 20px horizontal padding.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg font-sans text-fg antialiased">
        <div className="mx-auto flex min-h-screen w-full max-w-[1000px] flex-col px-5">
          <SiteHeader />
          <main className="flex-1 py-10">{children}</main>
          <footer className="pb-8 pt-4 text-xs text-sub">
            Corium — anything shared here is gone in 24 hours.
          </footer>
        </div>
      </body>
    </html>
  );
}
