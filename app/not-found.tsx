import Link from 'next/link';

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
      <Link
        href="/"
        className={`${buttonVariants({ variant: 'outline' })} mt-8`}
      >
        Go home
      </Link>
    </div>
  );
}
