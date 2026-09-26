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
  experimental: {
    serverActions: {
      // File shares travel through a Server Action (multipart). The 1 MB
      // default rejects anything bigger long before our own rules get a say —
      // raise it past the product limit for a whole set (10 files, 50 MB).
      bodySizeLimit: '56mb',
      ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}),
    },
  },
};

export default nextConfig;
