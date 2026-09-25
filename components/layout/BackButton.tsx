'use client';

import { usePathname, useRouter } from 'next/navigation';

/**
 * Small "← Back" affordance rendered above every page except the homepage
 * (where there is nowhere sensible to go back to). Uses history so it lands
 * where the visitor actually came from.
 */
export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();

  if (pathname === '/') return null;

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="mb-6 inline-flex items-center gap-1.5 text-xs text-sub transition-colors hover:text-fg"
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="h-3.5 w-3.5"
      >
        <path
          d="M19 12H5m0 0 6-6m-6 6 6 6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Back
    </button>
  );
}
