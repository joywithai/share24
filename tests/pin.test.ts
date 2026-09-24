import { describe, expect, it } from 'vitest';

import {
  createUnlockToken,
  hashPin,
  isValidUnlockToken,
  UNLOCK_TTL_MS,
  unlockCookieName,
  verifyPin,
} from '@/lib/pin';

describe('hashPin / verifyPin (bcrypt)', () => {
  it('round-trips a valid PIN', async () => {
    const hash = await hashPin('1234');
    expect(hash).not.toBe('1234');
    expect(hash).toMatch(/^\$2[aby]\$/);
    await expect(verifyPin('1234', hash)).resolves.toBe(true);
  });

  it('rejects a wrong PIN', async () => {
    const hash = await hashPin('1234');
    await expect(verifyPin('0000', hash)).resolves.toBe(false);
  });

  it('produces different hashes for the same PIN (salted)', async () => {
    const a = await hashPin('9999');
    const b = await hashPin('9999');
    expect(a).not.toBe(b);
  });
});

describe('unlock tokens', () => {
  const now = 1_700_000_000_000;

  it('accepts a freshly created token for the same route', () => {
    const token = createUnlockToken('my-route', now + 60_000);
    expect(isValidUnlockToken(token, 'my-route', now)).toBe(true);
  });

  it('rejects a token created for a different route', () => {
    const token = createUnlockToken('my-route', now + 60_000);
    expect(isValidUnlockToken(token, 'other-route', now)).toBe(false);
  });

  it('rejects a tampered token', () => {
    const token = createUnlockToken('my-route', now + 60_000);
    const tampered = `${token.slice(0, -4)}xxxx`;
    expect(isValidUnlockToken(tampered, 'my-route', now)).toBe(false);
  });

  it('rejects tokens that are structurally broken', () => {
    expect(isValidUnlockToken('', 'my-route', now)).toBe(false);
    expect(isValidUnlockToken('no-dot-here', 'my-route', now)).toBe(false);
    expect(isValidUnlockToken('.payload-only', 'my-route', now)).toBe(false);
    expect(isValidUnlockToken('payload.', 'my-route', now)).toBe(false);
  });

  it('rejects expired tokens', () => {
    const token = createUnlockToken('my-route', now - 1);
    expect(isValidUnlockToken(token, 'my-route', now)).toBe(false);
  });

  it('defaults to a one-hour validity window', () => {
    const token = createUnlockToken('my-route');
    expect(
      isValidUnlockToken(token, 'my-route', Date.now() + UNLOCK_TTL_MS / 2),
    ).toBe(true);
  });
});

describe('unlockCookieName', () => {
  it('is scoped per route and cookie-safe', () => {
    expect(unlockCookieName('my-route')).toBe('corium_unlock_my-route');
    expect(unlockCookieName('a_b-c9')).toBe('corium_unlock_a_b-c9');
  });
});
