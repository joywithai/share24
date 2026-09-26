/**
 * The security headers every response carries.
 *
 * Kept in one module so `next.config.ts` stays readable and the admin panel can
 * show exactly what is being sent.
 *
 * Two deliberate choices:
 *
 *   - **No `frame-ancestors` / `X-Frame-Options`.** The app is meant to run
 *     inside the sandbox preview's iframe (and inside any reverse proxy a
 *     self-hoster puts in front of it), and both directives would blank the
 *     page there. If you serve it top-level, add `frame-ancestors 'none'` at
 *     your proxy — see DEPLOYMENT.md.
 *   - **`'unsafe-inline'` stays in `script-src`.** Next.js inlines its own
 *     bootstrap/flight scripts; without a nonce (which needs a proxy that can
 *     rewrite HTML) the choice is between an allow-list that blocks them and
 *     this. Everything *external* is still refused, which is what the header
 *     is really for here: no third-party script can be pulled in.
 */

const isDev = process.env.NODE_ENV !== 'production';

export function contentSecurityPolicy(): string {
  const directives = [
    "default-src 'self'",
    isDev
      ? // The dev server evaluates modules and talks to its HMR websocket.
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'",
    // Monaco (and Next) inject styles at runtime.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    isDev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    // Monaco builds its language workers from blob URLs.
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'self' blob:",
  ];
  if (!isDev) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** Headers sent with every HTML/document response. */
export function securityHeaders(): { key: string; value: string }[] {
  const headers = [
    // Downloads are served as attachments; this stops a browser from
    // second-guessing a `text/plain` and running it as HTML.
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=()',
    },
    { key: 'X-DNS-Prefetch-Control', value: 'off' },
    { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
  ];

  if (!isDev) {
    // Only meaningful over TLS, and only once the domain is stable.
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains',
    });
  }
  return headers;
}
