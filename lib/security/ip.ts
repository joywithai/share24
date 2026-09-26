/**
 * Who is asking, as far as a self-hosted app can tell.
 *
 * Behind a reverse proxy (Vercel, nginx, a sandbox preview) `request.url` is
 * the internal address, so the client is only visible in the forwarding
 * headers. `x-forwarded-for` is a comma-separated chain — closest client
 * first — and any of it can be forged by the caller, so this is used for rate
 * limiting and logging, never as a proof of identity.
 */

/** Headers we look at, in order of preference. */
const IP_HEADERS = [
  'x-forwarded-for',
  'x-real-ip',
  'cf-connecting-ip',
  'x-vercel-forwarded-for',
] as const;

export const UNKNOWN_IP = 'unknown';

/** A header bag: `Headers` (route handlers) or the one `next/headers` returns. */
export type HeaderSource = { get(name: string): string | null };

/**
 * A syntactically valid IPv4/IPv6 literal. Anything else (a host name, a
 * header-injection attempt, an empty value) is treated as unknown rather than
 * used as a rate-limit key.
 */
export function normalizeIp(value: string | null | undefined): string | null {
  const raw = value?.trim().replace(/^\[|\]$/g, '') ?? '';
  if (!raw || raw.length > 45) return null;
  if (raw === '::1') return '::1';

  // IPv4 (optionally with a port, as some proxies append).
  const v4 = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (v4) {
    const octets = v4[1].split('.').map(Number);
    return octets.every((octet) => octet <= 255) ? v4[1] : null;
  }

  // IPv6, including the IPv4-mapped form.
  if (/^[0-9a-f:]+$/i.test(raw) && raw.includes(':')) return raw.toLowerCase();
  return null;
}

/** The client address for a request, or `'unknown'`. */
export function clientIp(headers: HeaderSource): string {
  for (const header of IP_HEADERS) {
    const value = headers.get(header);
    if (!value) continue;
    // The chain's first entry is the closest client; the rest are proxies.
    const first = value.split(',')[0];
    const ip = normalizeIp(first);
    if (ip) return ip;
  }
  return UNKNOWN_IP;
}

/** True for addresses only reachable from inside the machine/network. */
export function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}
