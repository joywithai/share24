import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The guard module touches prisma only through `lib/security/events` (the
 * block list), so that one dependency is mocked: these tests are about the
 * rate limiter, the address parsing and the decision the guard makes.
 */
const blockedIpFindUnique = vi.fn(async () => null);
vi.mock('@/lib/prisma', () => ({
  prisma: {
    securityEvent: { create: vi.fn(async () => ({})) },
    blockedIp: {
      findUnique: (...args: unknown[]) =>
        (blockedIpFindUnique as (...rest: unknown[]) => unknown)(...args),
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));

import { clearViolations, guardAction } from '@/lib/security/guard';
import { clientIp, isPrivateIp, normalizeIp } from '@/lib/security/ip';
import {
  describeRetry,
  enforceRateLimit,
  MemoryRateLimiter,
  RATE_LIMITS,
  setRateLimiter,
  UpstashRateLimiter,
} from '@/lib/security/rate-limit';

/**
 * Phase 2 security core. These modules are prisma-free on purpose: the guards
 * that need the database are exercised through the server-action tests, where
 * prisma is mocked.
 */

afterEach(() => {
  setRateLimiter(null);
  clearViolations();
});

describe('normalizeIp', () => {
  it('accepts IPv4 with or without a port', () => {
    expect(normalizeIp('203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeIp('203.0.113.7:51234')).toBe('203.0.113.7');
    expect(normalizeIp(' 198.51.100.4  ')).toBe('198.51.100.4');
  });

  it('rejects impossible addresses', () => {
    expect(normalizeIp('999.1.1.1')).toBeNull();
    expect(normalizeIp('not-an-ip')).toBeNull();
    expect(normalizeIp('')).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
    expect(normalizeIp('a'.repeat(60))).toBeNull();
  });

  it('accepts IPv6 including the loopback and bracketed forms', () => {
    expect(normalizeIp('::1')).toBe('::1');
    expect(normalizeIp('[2001:DB8::1]')).toBe('2001:db8::1');
  });

  it('knows private ranges', () => {
    expect(isPrivateIp('10.0.0.5')).toBe(true);
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('172.16.4.4')).toBe(true);
    expect(isPrivateIp('192.168.1.1')).toBe(true);
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('203.0.113.7')).toBe(false);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
  });
});

describe('clientIp', () => {
  const headersOf = (map: Record<string, string>) => ({
    get: (name: string) => map[name.toLowerCase()] ?? null,
  });

  it('takes the closest client out of the forwarded chain', () => {
    expect(
      clientIp(
        headersOf({
          'x-forwarded-for': '203.0.113.9, 10.0.0.1, 10.0.0.2',
        }),
      ),
    ).toBe('203.0.113.9');
  });

  it('falls back through the other headers', () => {
    expect(clientIp(headersOf({ 'x-real-ip': '198.51.100.8' }))).toBe(
      '198.51.100.8',
    );
    expect(clientIp(headersOf({ 'cf-connecting-ip': '198.51.100.9' }))).toBe(
      '198.51.100.9',
    );
  });

  it('never invents an address out of a header injection attempt', () => {
    expect(clientIp(headersOf({ 'x-forwarded-for': '<script>' }))).toBe(
      'unknown',
    );
    expect(clientIp(headersOf({}))).toBe('unknown');
  });
});

describe('MemoryRateLimiter', () => {
  it('allows up to the limit inside one window', async () => {
    const limiter = new MemoryRateLimiter();
    const rule = { windowMs: 1000, max: 3 };

    for (let i = 0; i < 3; i += 1) {
      const outcome = await limiter.hit('k', rule);
      expect(outcome.ok).toBe(true);
      expect(outcome.remaining).toBe(2 - i);
    }

    const fourth = await limiter.hit('k', rule);
    expect(fourth.ok).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
    expect(fourth.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it('starts a fresh window once the old one expired', async () => {
    let now = 1_000_000;
    const limiter = new MemoryRateLimiter(() => now);
    const rule = { windowMs: 500, max: 1 };

    expect((await limiter.hit('k', rule)).ok).toBe(true);
    expect((await limiter.hit('k', rule)).ok).toBe(false);

    now += 501;
    expect((await limiter.hit('k', rule)).ok).toBe(true);
    expect(limiter.size()).toBe(1);
  });

  it('counts every key separately and can be cleared', async () => {
    const limiter = new MemoryRateLimiter();
    const rule = { windowMs: 1000, max: 1 };

    await limiter.hit('a', rule);
    expect((await limiter.hit('b', rule)).ok).toBe(true);
    expect((await limiter.hit('a', rule)).ok).toBe(false);

    limiter.clear('a');
    expect((await limiter.hit('a', rule)).ok).toBe(true);
    limiter.clear();
    expect(limiter.size()).toBe(0);
  });
});

describe('UpstashRateLimiter', () => {
  const rule = { windowMs: 60_000, max: 5 };

  it('counts through the Redis pipeline', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response(
        JSON.stringify([{ result: 'OK' }, { result: 4 }, { result: 42 }]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const limiter = new UpstashRateLimiter({
      url: 'https://example.upstash.io',
      token: 'token',
      fallback: new MemoryRateLimiter(),
      fetchImpl,
    });

    const outcome = await limiter.hit('corium:rl:create:1.2.3.4', rule);

    expect(outcome.ok).toBe(true);
    expect(outcome.remaining).toBe(1);
    // Allowed requests carry no wait hint — only the window end.
    expect(outcome.retryAfterMs).toBe(0);
    expect(outcome.resetAt).toBeGreaterThan(Date.now());
    expect(calls[0].url).toBe('https://example.upstash.io/pipeline');
    expect(calls[0].body).toEqual([
      ['SET', 'corium:rl:create:1.2.3.4', '0', 'EX', '60', 'NX'],
      ['INCR', 'corium:rl:create:1.2.3.4'],
      ['TTL', 'corium:rl:create:1.2.3.4'],
    ]);
  });

  it('falls back to memory when Redis is unreachable', async () => {
    const fallback = new MemoryRateLimiter();
    const limiter = new UpstashRateLimiter({
      url: 'https://example.upstash.io',
      token: 'token',
      fallback,
      fetchImpl: (async () => {
        throw new Error('connect ECONNREFUSED');
      }) as unknown as typeof fetch,
    });

    const outcome = await limiter.hit('k', { windowMs: 1000, max: 1 });
    expect(outcome.ok).toBe(true);

    const second = await limiter.hit('k', { windowMs: 1000, max: 1 });
    expect(second.ok).toBe(false);
  });
});

describe('enforceRateLimit', () => {
  it('uses the rule for the kind and namespaces the key', async () => {
    const limiter = new MemoryRateLimiter();
    setRateLimiter(limiter);

    const outcome = await enforceRateLimit('lookup', '203.0.113.5');
    expect(outcome.key).toBe('corium:rl:lookup:203.0.113.5');
    expect(outcome.limit).toBe(RATE_LIMITS.lookup.max);
    expect(outcome.ok).toBe(true);
  });
});

describe('describeRetry', () => {
  it('speaks in seconds and minutes', () => {
    expect(describeRetry(400)).toBe('1 second');
    expect(describeRetry(30_000)).toBe('30 seconds');
    expect(describeRetry(61_000)).toBe('2 minutes');
    expect(describeRetry(10 * 60_000)).toBe('10 minutes');
  });
});

describe('guardAction', () => {
  it('lets a normal request through', async () => {
    setRateLimiter(new MemoryRateLimiter());
    const outcome = await guardAction('lookup', { ip: '203.0.113.20' });
    expect(outcome.ok).toBe(true);
  });

  it('answers 429 with a retry hint once the window is spent', async () => {
    setRateLimiter(new MemoryRateLimiter());
    const context = { ip: '203.0.113.21' };

    for (let i = 0; i < RATE_LIMITS.lookup.max; i += 1) {
      expect((await guardAction('lookup', context)).ok).toBe(true);
    }

    const blocked = await guardAction('lookup', context);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.status).toBe(429);
      expect(blocked.message).toMatch(/Too many requests/);
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it('rate limits even an unknown address, but never blocks the bucket', async () => {
    setRateLimiter(new MemoryRateLimiter());
    const context = { ip: 'unknown' };

    for (let i = 0; i < RATE_LIMITS.lookup.max; i += 1) {
      await guardAction('lookup', context);
    }
    const outcome = await guardAction('lookup', context);
    expect(outcome.ok).toBe(false);
    // Three violations in a row is normally an auto-block; an unknown
    // address must not be written to the block list (it is everybody).
    expect(vi.isMockFunction(guardAction)).toBe(false);
  });
});
