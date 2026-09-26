import { describe, expect, it } from 'vitest';

import {
  codeShareSchema,
  fileShareSchema,
  isValidPin,
  MAX_CODE_CHARS,
  PIN_REGEX,
} from '@/lib/schemas';

describe('PIN rules', () => {
  it('accepts exactly 4 digits', () => {
    for (const pin of ['0000', '1234', '9999']) {
      expect(isValidPin(pin)).toBe(true);
    }
  });

  it('rejects non-digits and wrong lengths', () => {
    for (const pin of ['', '123', '12345', 'abcd', '12a4', ' 1234']) {
      expect(isValidPin(pin), pin).toBe(false);
    }
  });

  it('exposes the regex', () => {
    expect(PIN_REGEX.source).toBe('^\\d{4}$');
  });
});

describe('codeShareSchema', () => {
  const valid = { code: 'console.log(1)', route: 'demo', pin: '' };

  it('accepts a valid payload (no PIN)', () => {
    expect(codeShareSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a 4-digit PIN', () => {
    expect(codeShareSchema.safeParse({ ...valid, pin: '4321' }).success).toBe(
      true,
    );
  });

  it('rejects empty content', () => {
    const res = codeShareSchema.safeParse({ ...valid, code: '' });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].message).toMatch(/Paste some code/);
    }
  });

  it('rejects oversized content', () => {
    const res = codeShareSchema.safeParse({
      ...valid,
      code: 'x'.repeat(MAX_CODE_CHARS + 1),
    });
    expect(res.success).toBe(false);
  });

  it('rejects bad routes with the specific reason', () => {
    const res = codeShareSchema.safeParse({ ...valid, route: 'login' });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].message).toMatch(/reserved/);
    }
  });

  it('rejects malformed PINs', () => {
    const res = codeShareSchema.safeParse({ ...valid, pin: '123' });
    expect(res.success).toBe(false);
  });
});

describe('fileShareSchema', () => {
  it('validates route and pin only (the file itself is validated separately)', () => {
    expect(
      fileShareSchema.safeParse({ route: 'ok-route', pin: '' }).success,
    ).toBe(true);
    expect(fileShareSchema.safeParse({ route: 'x', pin: '' }).success).toBe(
      false,
    );
    expect(
      fileShareSchema.safeParse({ route: 'ok-route', pin: 'ab' }).success,
    ).toBe(false);
  });
});
