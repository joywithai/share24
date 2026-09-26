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

describe('download tokens', () => {
  it('accepts a token minted for the same route and scope', async () => {
    const { createDownloadToken, isValidDownloadToken, DOWNLOAD_SCOPE_ALL } =
      await import('@/lib/download-token');
    const token = createDownloadToken('my-route', DOWNLOAD_SCOPE_ALL);

    expect(isValidDownloadToken(token, 'my-route', DOWNLOAD_SCOPE_ALL)).toBe(
      true,
    );
  });

  it('refuses another route, another scope, a tampered token or an expired one', async () => {
    const { createDownloadToken, isValidDownloadToken, DOWNLOAD_SCOPE_ALL } =
      await import('@/lib/download-token');
    const token = createDownloadToken('my-route', DOWNLOAD_SCOPE_ALL);

    expect(isValidDownloadToken(token, 'other-route', DOWNLOAD_SCOPE_ALL)).toBe(
      false,
    );
    expect(isValidDownloadToken(token, 'my-route', 'file-id-123')).toBe(false);
    expect(
      isValidDownloadToken(`${token}x`, 'my-route', DOWNLOAD_SCOPE_ALL),
    ).toBe(false);
    // The payload says `dl|all|my-route|<ts>|extra` — swapping the scope inside
    // the signed payload must fail the HMAC check.
    const forgedPayload = Buffer.from(
      `dl|other-file|my-route|${Date.now() + 60_000}`,
      'utf8',
    ).toString('base64url');
    const mac = token.slice(token.indexOf('.') + 1);
    expect(
      isValidDownloadToken(`${forgedPayload}.${mac}`, 'my-route', 'other-file'),
    ).toBe(false);

    const expired = createDownloadToken(
      'my-route',
      DOWNLOAD_SCOPE_ALL,
      Date.now() - 1,
    );
    expect(isValidDownloadToken(expired, 'my-route', DOWNLOAD_SCOPE_ALL)).toBe(
      false,
    );
  });

  it('never outlives the share it belongs to', async () => {
    const { downloadTokenExpiry } = await import('@/lib/download-token');
    const soon = new Date(Date.now() + 5 * 60_000);
    expect(downloadTokenExpiry(soon)).toBe(soon.getTime());

    const later = new Date(Date.now() + 24 * 60 * 60_000);
    expect(downloadTokenExpiry(later)).toBeLessThanOrEqual(
      Date.now() + 60 * 60_000 + 5,
    );
  });
});
