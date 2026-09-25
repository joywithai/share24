import { describe, expect, it } from 'vitest';

import { compactHost } from '@/lib/utils';

describe('compactHost', () => {
  it('leaves a short host alone', () => {
    expect(compactHost('sharetofnd')).toBe('sharetofnd');
    expect(compactHost('arena.site')).toBe('arena.site');
  });

  it('keeps only the tail of a long preview host', () => {
    expect(compactHost('sbx-cdza2eyzvobinpf7.arena.site')).toBe('…arena.site');
    expect(compactHost('a.b.c.d.example.com')).toBe('…example.com');
  });

  it('never mangles a port or an IP address', () => {
    expect(compactHost('localhost:3000')).toBe('localhost:3000');
    expect(compactHost('127.0.0.1:3000')).toBe('127.0.0.1:3000');
    expect(compactHost('sharetofnd.app:8080')).toBe('sharetofnd.app:8080');
  });

  it('takes the number of labels to keep as an argument', () => {
    expect(compactHost('a.b.example.com', 1)).toBe('…com');
    expect(compactHost('a.b.example.com', 3)).toBe('…b.example.com');
  });
});
