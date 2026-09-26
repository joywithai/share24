import Link from 'next/link';

import { GoBackButton } from '@/components/layout/GoBackButton';
import { buttonVariants } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="font-mono text-6xl font-bold text-accent">404</p>
      <h1 className="mt-4 text-xl font-semibold">Nothing here</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-sub">
        This link doesn&rsquo;t exist — or the share it pointed to expired and
        released its route.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <GoBackButton />
        <Link href="/" className={buttonVariants({ variant: 'default' })}>
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-4 w-4"
          >
            <path
              d="m3 10.5 9-6.5 9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Go home
        </Link>
      </div>
    </div>
  );
}
