import { describe, expect, it } from 'vitest';

import { normalizeRoute, routeProblem } from '@/lib/route';

describe('normalizeRoute', () => {
  it('trims and lowercases', () => {
    expect(normalizeRoute('  My-Route_01 ')).toBe('my-route_01');
  });
});

describe('routeProblem', () => {
  it('accepts valid routes', () => {
    for (const route of [
      'abc',
      'my-snippet',
      'a_b_c',
      'route-123',
      'a'.repeat(50),
    ]) {
      expect(routeProblem(route), route).toBeNull();
    }
  });

  it('rejects routes that are too short', () => {
    expect(routeProblem('ab')).toMatch(/at least 3/);
  });

  it('rejects routes that are too long', () => {
    expect(routeProblem('a'.repeat(51))).toMatch(/50 characters or fewer/);
  });

  it('rejects invalid characters', () => {
    expect(routeProblem('has space')).toMatch(/lowercase letters/);
    expect(routeProblem('has.dot')).toMatch(/lowercase letters/);
    expect(routeProblem('has/slash')).toMatch(/lowercase letters/);
    expect(routeProblem('UPPER')).toBeNull(); // normalization makes it valid
  });

  it('rejects reserved routes', () => {
    for (const reserved of [
      'api',
      'auth',
      'login',
      'register',
      'create',
      'profile',
      'favicon',
      'robots',
      'sitemap',
      '_next',
    ]) {
      expect(routeProblem(reserved), reserved).toMatch(/reserved/);
    }
  });
});
