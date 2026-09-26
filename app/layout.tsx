import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { BackButton } from '@/components/layout/BackButton';
import { Brand } from '@/components/layout/Brand';
import { MaintenanceBanner } from '@/components/layout/MaintenanceBanner';
import { SiteHeader } from '@/components/layout/SiteHeader';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Sharetofnd',
    template: '%s · Sharetofnd',
  },
  description:
    'Paste or drop it, name it, share the link — every share self-destructs after 24 hours. No account needed.',
};

export const viewport: Viewport = {
  themeColor: '#0b0d0f',
};

/**
 * Root layout — enforces the layout constraint once for every page:
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
          <MaintenanceBanner />
          <main className="flex-1 py-10">
            <BackButton />
            {children}
          </main>
          <footer className="flex flex-wrap items-center gap-x-1.5 pb-8 pt-4 text-xs text-sub">
            <Brand size="text-xs" tag={false} />
            <span>— anything shared here is gone in 24 hours.</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
