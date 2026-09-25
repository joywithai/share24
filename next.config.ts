import type { NextConfig } from 'next';

/**
 * Origins allowed to post to Server Actions *in addition* to the request's own
 * host (comma-separated, `*` wildcards allowed — e.g. `*.example.app`).
 *
 * Next.js rejects a Server Action when the `Origin` header's host differs from
 * the `Host`/`x-forwarded-host` it sees. That is the right default, but it
 * trips over reverse proxies that terminate TLS and rewrite `Host` to the
 * internal address while the browser still sends the public `Origin`. List
 * those public origins here instead of disabling the check globally.
 */
const allowedOrigins = (process.env.CORIUM_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  ...(allowedOrigins.length > 0
    ? // Next.js 15 still nests this under `experimental`.
      { experimental: { serverActions: { allowedOrigins } } }
    : {}),
};

export default nextConfig;
