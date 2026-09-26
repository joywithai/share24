import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkRateLimit,
  describeRetry,
  describeWindow,
  isRateLimited,
  MemoryRateLimiter,
  RATE_LIMIT_PROFILES,
  RATE_LIMITS,
  rateLimitIdentifier,
  setRateLimiter,
  UpstashRateLimiter,
} from '@/lib/rate-limit';

/**
 * The rate limits, by name.
 *
 * The numbers are the contract an operator agreed to, so they are asserted
 * here rather than only living in a constant: `createShare` 10/hour,
 * `uploadFile` 20/hour, `verifyPin` 5/minute per address *and* route,
 * `download` 30/hour, `login` 5/15 minutes. Everything runs against the
 * in-memory limiter (and a stubbed Upstash), so no network is involved.
 */

beforeEach(() => {
  setRateLimiter(new MemoryRateLimiter());
});

afterEach(() => {
  setRateLimiter(null);
  vi.unstubAllGlobals();
});

describe('the profiles', () => {
  it('maps every name onto a rule with the agreed window', () => {
    expect(RATE_LIMIT_PROFILES.createShare.kind).toBe('create');
    expect(RATE_LIMIT_PROFILES.uploadFile.kind).toBe('upload');
    expect(RATE_LIMIT_PROFILES.verifyPin.kind).toBe('pin');
    expect(RATE_LIMIT_PROFILES.download.kind).toBe('download');
    expect(RATE_LIMIT_PROFILES.login.kind).toBe('login');

    expect(RATE_LIMITS.create).toMatchObject({ max: 10, windowMs: 3_600_000 });
    expect(RATE_LIMITS.upload).toMatchObject({ max: 20, windowMs: 3_600_000 });
    expect(RATE_LIMITS.pin).toMatchObject({
      max: 5,
      windowMs: 60_000,
      perRoute: true,
    });
    expect(RATE_LIMITS.download).toMatchObject({
      max: 30,
      windowMs: 3_600_000,
    });
    expect(RATE_LIMITS.login).toMatchObject({ max: 5, windowMs: 900_000 });
  });

  it('says which identifier each profile counts on', () => {
    expect(RATE_LIMIT_PROFILES.createShare.per).toBe('IP');
    expect(RATE_LIMIT_PROFILES.uploadFile.per).toBe('IP');
    expect(RATE_LIMIT_PROFILES.verifyPin.per).toBe('IP + route');
    expect(RATE_LIMIT_PROFILES.download.per).toBe('IP');
    expect(RATE_LIMIT_PROFILES.login.per).toBe('IP');
  });

  it('describes a window in words', () => {
    expect(describeWindow(3_600_000)).toBe('1 hour');
    expect(describeWindow(7_200_000)).toBe('2 hours');
    expect(describeWindow(900_000)).toBe('15 min');
    expect(describeWindow(60_000)).toBe('1 min');
    expect(describeWindow(1_500)).toBe('2 seconds');
  });
});

describe('counting', () => {
  it('allows ten shares an hour and refuses the eleventh', async () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const hit = await checkRateLimit('createShare', '203.0.113.7');
      expect(hit.ok).toBe(true);
      expect(hit.remaining).toBe(10 - attempt);
    }

    const refused = await checkRateLimit('createShare', '203.0.113.7');
    expect(refused.ok).toBe(false);
    expect(refused.remaining).toBe(0);
    expect(refused.retryAfterMs).toBeGreaterThan(0);
    expect(refused.message).toMatch(
      /Too many requests\. Try again in 1 hour\./,
    );
  });

  it('gives uploads their own, roomier window', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await checkRateLimit('createShare', '198.51.100.4');
    }
    // The code-share window is exhausted …
    expect(await isRateLimited('createShare', '198.51.100.4')).toBe(true);
    // … while uploading files from the same address is untouched (20/hour).
    const upload = await checkRateLimit('uploadFile', '198.51.100.4');
    expect(upload.ok).toBe(true);
    expect(upload.limit).toBe(20);
  });

  it('counts PIN attempts per address and route', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const hit = await checkRateLimit('verifyPin', '203.0.113.9', {
        route: 'secret-one',
      });
      expect(hit.ok).toBe(true);
    }
    const sixthOnSameRoute = await checkRateLimit('verifyPin', '203.0.113.9', {
      route: 'secret-one',
    });
    expect(sixthOnSameRoute.ok).toBe(false);

    // A different share is a different attack — and a different counter.
    const otherRoute = await checkRateLimit('verifyPin', '203.0.113.9', {
      route: 'secret-two',
    });
    expect(otherRoute.ok).toBe(true);

    // A different address on the first route is also unaffected.
    const otherAddress = await checkRateLimit('verifyPin', '203.0.113.10', {
      route: 'secret-one',
    });
    expect(otherAddress.ok).toBe(true);
  });

  it('keys the PIN counter by route and the rest by address alone', () => {
    expect(rateLimitIdentifier('pin', '1.2.3.4', 'my-share')).toBe(
      '1.2.3.4:my-share',
    );
    expect(rateLimitIdentifier('pin', '1.2.3.4', null)).toBe('1.2.3.4');
    expect(rateLimitIdentifier('create', '1.2.3.4', 'my-share')).toBe(
      '1.2.3.4',
    );
    expect(rateLimitIdentifier('download', '1.2.3.4', 'my-share')).toBe(
      '1.2.3.4',
    );
  });

  it('allows thirty downloads an hour', async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect((await checkRateLimit('download', '192.0.2.5')).ok).toBe(true);
    }
    expect(await isRateLimited('download', '192.0.2.5')).toBe(true);
  });

  it('allows five sign-ins per quarter hour', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await checkRateLimit('login', '192.0.2.6')).ok).toBe(true);
    }
    const refused = await checkRateLimit('login', '192.0.2.6');
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/Try again in 15 minutes\./);
  });

  it('keeps addresses apart', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await checkRateLimit('createShare', 'one');
    }
    expect(await isRateLimited('createShare', 'one')).toBe(true);
    expect(await isRateLimited('createShare', 'two')).toBe(false);
  });

  it('starts a fresh window when the old one expires', async () => {
    let now = 1_000_000;
    setRateLimiter(new MemoryRateLimiter(() => now));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await checkRateLimit('verifyPin', 'ip', { route: 'r' });
    }
    expect(await isRateLimited('verifyPin', 'ip', { route: 'r' })).toBe(true);

    now += 60_001; // one minute later
    expect(await isRateLimited('verifyPin', 'ip', { route: 'r' })).toBe(false);
  });

  it('describes the wait a refused caller has to sit out', () => {
    expect(describeRetry(1_000)).toBe('1 second');
    expect(describeRetry(45_000)).toBe('45 seconds');
    expect(describeRetry(3_599_000)).toBe('60 minutes');
    expect(describeRetry(90_000)).toBe('2 minutes');
    expect(describeRetry(60_000)).toBe('1 minute');
    expect(describeRetry(3_600_000)).toBe('1 hour');
  });
});

describe('Redis, when it is configured', () => {
  it('counts in Upstash and keeps the same windows', async () => {
    const calls: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init.body);
      return new Response(
        JSON.stringify([{ result: 'OK' }, { result: 3 }, { result: 42 }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const limiter = new UpstashRateLimiter({
      url: 'https://example.upstash.io',
      token: 'token',
      fallback: new MemoryRateLimiter(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const hit = await limiter.hit(
      'corium:rl:create:1.2.3.4',
      RATE_LIMITS.create,
    );

    expect(hit.ok).toBe(true);
    expect(hit.limit).toBe(10);
    expect(hit.remaining).toBe(7);
    expect(hit.resetAt).toBeGreaterThan(Date.now());
    expect(String(calls[0])).toContain('"INCR"');
    // The window handed to Redis is the rule's window in seconds.
    expect(String(calls[0])).toContain('"3600"');
  });

  it('falls back to memory when Redis answers badly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 }));
    const limiter = new UpstashRateLimiter({
      url: 'https://example.upstash.io',
      token: 'token',
      fallback: new MemoryRateLimiter(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const hit = await limiter.hit('k', { windowMs: 60_000, max: 2 });
    expect(hit.ok).toBe(true);
    expect(hit.limit).toBe(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('gives up on a hung Redis instead of holding the request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const limiter = new UpstashRateLimiter({
      url: 'https://example.upstash.io',
      token: 'token',
      fallback: new MemoryRateLimiter(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 5,
    });

    const hit = await limiter.hit('k', { windowMs: 60_000, max: 3 });
    expect(hit.ok).toBe(true);
    expect(hit.limit).toBe(3);
    warn.mockRestore();
  });
});
