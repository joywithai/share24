'use client';

import { useRouter } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';

/**
 * "Go back" for dead ends (404, expired shares). Uses the browser history so
 * the visitor lands where they came from — and falls back to the homepage when
 * there is nothing to go back to (e.g. a link opened straight in a new tab).
 */
export function GoBackButton({ label = 'Go back' }: { label?: string }) {
  const router = useRouter();

  function handleClick() {
    // `history.length > 1` is the usual signal that this tab navigated at
    // least once; a cold entry has nothing to go back to.
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/');
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={buttonVariants({ variant: 'outline' })}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-4 w-4"
      >
        <path
          d="M19 12H5m0 0 6-6m-6 6 6 6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </button>
  );
}
