import { describe, expect, it } from 'vitest';

import {
  expiryFrom,
  formatRemaining,
  isShareExpired,
  msUntil,
  SHARE_TTL_MS,
} from '@/lib/expire';

describe('SHARE_TTL_MS', () => {
  it('is 24 hours', () => {
    expect(SHARE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('expiryFrom', () => {
  it('adds exactly 24 hours', () => {
    const created = new Date('2026-09-24T12:00:00.000Z');
    expect(expiryFrom(created).toISOString()).toBe('2026-09-25T12:00:00.000Z');
  });

  it('defaults to now', () => {
    const before = Date.now();
    const expiry = expiryFrom();
    const after = Date.now();
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + SHARE_TTL_MS);
    expect(expiry.getTime()).toBeLessThanOrEqual(after + SHARE_TTL_MS);
  });
});

describe('isShareExpired', () => {
  const now = new Date('2026-09-24T12:00:00.000Z');

  it('is expired when the flag is set', () => {
    expect(
      isShareExpired(
        { isExpired: true, expiresAt: new Date(now.getTime() + 60_000) },
        now,
      ),
    ).toBe(true);
  });

  it('is expired when expiresAt is in the past (lazy expiration)', () => {
    expect(
      isShareExpired(
        { isExpired: false, expiresAt: new Date(now.getTime() - 1) },
        now,
      ),
    ).toBe(true);
  });

  it('is live when not flagged and not past expiry', () => {
    expect(
      isShareExpired(
        { isExpired: false, expiresAt: new Date(now.getTime() + 60_000) },
        now,
      ),
    ).toBe(false);
  });

  it('treats exact expiry as expired', () => {
    expect(isShareExpired({ isExpired: false, expiresAt: now }, now)).toBe(
      true,
    );
  });
});

describe('formatRemaining', () => {
  it('formats days, hours, minutes and seconds', () => {
    expect(formatRemaining(25 * 3600_000)).toBe('1d 1h');
    expect(formatRemaining(90 * 60_000)).toBe('1h 30m');
    expect(formatRemaining(9 * 60_000 + 32_000)).toBe('9m 32s');
    expect(formatRemaining(5_000)).toBe('5s');
  });

  it('says expired for non-positive durations', () => {
    expect(formatRemaining(0)).toBe('expired');
    expect(formatRemaining(-1000)).toBe('expired');
  });
});

describe('msUntil', () => {
  it('computes the difference', () => {
    expect(msUntil(new Date(2000), new Date(0))).toBe(2000);
    expect(msUntil(new Date(0), new Date(2000))).toBe(-2000);
  });
});
