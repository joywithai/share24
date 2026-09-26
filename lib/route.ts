/**
 * Route validation — shared by the client forms (via the Zod schemas in
 * `lib/schemas.ts`) and the server actions (server-side re-validation is
 * mandatory, never trust the client).
 *
 * This module must stay dependency-free: it is imported from client
 * components, so nothing here may touch the database or node builtins.
 */

/** A route is 3–50 lowercase alphanumerics, hyphens or underscores. */
export const ROUTE_REGEX = /^[a-z0-9_-]{3,50}$/;

/**
 * Routes that must never be claimable as share slugs — they collide with
 * application pages, framework internals or security-sensitive paths.
 */
export const RESERVED_ROUTES = new Set([
  'api',
  'auth',
  'login',
  'register',
  'create',
  'profile',
  'favicon',
  'robots',
  'sitemap',
  '_next',
  'public',
  'static',
  'webmanifest',
]);

export function normalizeRoute(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Returns a human-readable problem description, or `null` when the route is
 * valid. Availability (is another *active* share using it right now?) is
 * checked separately against the database in `isRouteTaken`.
 */
export function routeProblem(input: string): string | null {
  const route = normalizeRoute(input);
  if (route.length < 3) {
    return 'Route must be at least 3 characters long.';
  }
  if (route.length > 50) {
    return 'Route must be 50 characters or fewer.';
  }
  if (!ROUTE_REGEX.test(route)) {
    return 'Route can only use lowercase letters, numbers, hyphens and underscores.';
  }
  if (RESERVED_ROUTES.has(route)) {
    return `“${route}” is a reserved route and cannot be used.`;
  }
  return null;
}

// Note: route *availability* (is an active share currently using this
// route?) is a database question and is checked inside the server actions'
// transactions — see `app/actions/share.ts`. Keeping it out of this module
// means client components can import the pure validators above without
// dragging the database layer into the browser bundle.
