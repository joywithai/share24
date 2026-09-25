'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { normalizeRoute, routeProblem } from '@/lib/route';

/**
 * Accepts either a bare slug (`any-name`) or a pasted share link
 * (`https://host/any-name`) and returns the slug part.
 */
export function slugFromInput(input: string): string {
  const trimmed = input.trim();
  const withoutOrigin = trimmed.replace(/^https?:\/\/[^/]+/i, '');
  return normalizeRoute(withoutOrigin.split('/').filter(Boolean)[0] ?? '');
}

/**
 * "Open a share" box on the homepage: type (or paste) the name somebody gave
 * you and jump straight to it. Unknown names land on the 404 page, which the
 * share route already renders through `notFound()` — so an expired or
 * mistyped slug comes back with a Back button.
 */
export function RouteGoBox() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The live origin is read after mount so the server and the first client
  // render agree (no hydration mismatch).
  const [origin, setOrigin] = useState('https://sharetofnd');

  useEffect(() => {
    setOrigin(window.location.origin.replace(/^https?:\/\//, ''));
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const route = slugFromInput(value);
    const problem = routeProblem(route);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    router.push(`/${route}`);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 w-full max-w-md text-left">
      <div className="flex w-full min-w-0 items-stretch overflow-hidden rounded-lg border border-line bg-card font-mono text-xs transition-colors focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/30 sm:text-sm">
        <span
          aria-hidden
          className="flex shrink-0 items-center border-r border-line bg-card-soft px-3 py-2.5 text-sub"
        >
          {origin}/
        </span>
        <label className="sr-only" htmlFor="go-route">
          Share name
        </label>
        <input
          id="go-route"
          name="route"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          placeholder="any-name"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'go-route-error' : undefined}
          className="h-11 min-w-0 flex-1 bg-transparent px-3 text-fg placeholder:text-sub/60 focus:outline-none"
        />
        <Button
          type="submit"
          className="shrink-0 rounded-none border-l border-line px-4 font-sans text-xs"
        >
          Go
        </Button>
      </div>
      {error ? (
        <p
          id="go-route-error"
          role="alert"
          className="mt-2 text-xs text-danger"
        >
          {error}
        </p>
      ) : (
        <p className="mt-2 text-xs text-sub/70">
          You pick the name — that&rsquo;s the whole link.
        </p>
      )}
    </form>
  );
}
