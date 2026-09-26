// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecentSlugs } from '@/components/share/RecentSlugs';
import {
  MAX_RECENT_SLUGS,
  RECENT_SLUGS_KEY,
  readRecentSlugs,
  rememberSlug,
} from '@/lib/recent-slugs';

const HOUR = 60 * 60 * 1000;

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.sessionStorage.clear();
});

function readStored(): unknown {
  return JSON.parse(window.sessionStorage.getItem(RECENT_SLUGS_KEY) ?? 'null');
}

describe('recent slug storage', () => {
  it('remembers a slug with the time it was created', () => {
    const now = 1_700_000_000_000;
    rememberSlug('my-snippet', now);

    expect(readStored()).toEqual([{ slug: 'my-snippet', at: now }]);
    expect(readRecentSlugs(now)).toEqual([{ slug: 'my-snippet', at: now }]);
  });

  it('keeps the newest first and moves a repeated slug to the front', () => {
    rememberSlug('first', 1_000);
    rememberSlug('second', 2_000);
    expect(readRecentSlugs(2_000).map((entry) => entry.slug)).toEqual([
      'second',
      'first',
    ]);

    // Creating a share with an old name reuses the route — the chip moves up
    // instead of appearing twice.
    rememberSlug('first', 3_000);
    expect(readRecentSlugs(3_000).map((entry) => entry.slug)).toEqual([
      'first',
      'second',
    ]);
    expect(readRecentSlugs(3_000)).toHaveLength(2);
  });

  it('drops entries once the share they point at would have expired', () => {
    const created = 1_000_000;
    rememberSlug('still-alive', created);
    rememberSlug('too-old', created - 25 * HOUR);
    window.sessionStorage.setItem(
      RECENT_SLUGS_KEY,
      JSON.stringify([
        { slug: 'too-old', at: created - 25 * HOUR },
        { slug: 'still-alive', at: created },
      ]),
    );

    expect(readRecentSlugs(created).map((entry) => entry.slug)).toEqual([
      'still-alive',
    ]);
    // The pruned list is written back, so the browser stops carrying it.
    expect(readStored()).toEqual([{ slug: 'still-alive', at: created }]);
    expect(readRecentSlugs(created + 24 * HOUR)).toEqual([]);
  });

  it('caps the list and ignores anything that is not a slug', () => {
    for (let i = 0; i < MAX_RECENT_SLUGS + 5; i += 1) {
      rememberSlug(`slug-${i}`, 1_000 + i);
    }
    const slugs = readRecentSlugs(2_000).map((entry) => entry.slug);
    expect(slugs).toHaveLength(MAX_RECENT_SLUGS);
    expect(slugs[0]).toBe(`slug-${MAX_RECENT_SLUGS + 4}`);

    expect(rememberSlug('no', 2_000).map((entry) => entry.slug)).not.toContain(
      'no',
    );
    expect(
      rememberSlug('UPPER CASE', 2_000).map((entry) => entry.slug),
    ).not.toContain('UPPER CASE');
  });

  it('survives a corrupt value in storage', () => {
    window.sessionStorage.setItem(RECENT_SLUGS_KEY, '{not json');
    expect(readRecentSlugs()).toEqual([]);

    window.sessionStorage.setItem(RECENT_SLUGS_KEY, '{"a":1}');
    expect(readRecentSlugs()).toEqual([]);

    window.sessionStorage.setItem(
      RECENT_SLUGS_KEY,
      JSON.stringify([{ slug: 'ok-one', at: Date.now() }, { nope: true }]),
    );
    expect(readRecentSlugs().map((entry) => entry.slug)).toEqual(['ok-one']);
  });

  it('ignores entries stamped in the future', () => {
    const now = 5_000_000;
    window.sessionStorage.setItem(
      RECENT_SLUGS_KEY,
      JSON.stringify([{ slug: 'from-the-future', at: now + 10 * HOUR }]),
    );
    expect(readRecentSlugs(now)).toEqual([]);
  });
});

describe('RecentSlugs', () => {
  it('renders nothing for a visitor who has not created anything', () => {
    render(<RecentSlugs />);
    expect(screen.queryByText(/Your slugs/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a chip per slug, newest first', async () => {
    const now = Date.now();
    rememberSlug('older-one', now - 60_000);
    rememberSlug('newest-one', now);
    render(<RecentSlugs />);

    const chips = await screen.findAllByRole('button');
    expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual([
      'Copy a link to /newest-one',
      'Copy a link to /older-one',
    ]);
    expect(screen.getByText(/Your slugs/)).toBeTruthy();
  });

  it('hides slugs whose share would already have expired', async () => {
    const now = Date.now();
    rememberSlug('live-one', now);
    window.sessionStorage.setItem(
      RECENT_SLUGS_KEY,
      JSON.stringify([
        { slug: 'live-one', at: now },
        { slug: 'gone-one', at: now - 25 * HOUR },
      ]),
    );
    render(<RecentSlugs />);

    expect(
      (await screen.findAllByRole('button')).map((chip) =>
        chip.getAttribute('aria-label'),
      ),
    ).toEqual(['Copy a link to /live-one']);
  });

  it('copies the full link when a chip is clicked, and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    rememberSlug('my-snippet', Date.now());
    render(<RecentSlugs />);

    fireEvent.click(await screen.findByRole('button'));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/my-snippet`,
      ),
    );
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('reports a refused clipboard instead of pretending it worked', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    // jsdom has no execCommand either, so both paths fail.
    rememberSlug('my-snippet', Date.now());
    render(<RecentSlugs />);

    fireEvent.click(await screen.findByRole('button'));

    expect(await screen.findByText('Copy failed')).toBeTruthy();
  });

  it('offers the arrows only once the strip overflows, and scrolls with them', async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) {
      rememberSlug(`chip-${i}`, now - (5 - i) * 1000);
    }
    render(<RecentSlugs />);
    await screen.findAllByRole('button');

    expect(screen.queryByLabelText('Scroll slugs right')).toBeNull();

    const scroller = screen.getByTestId('recent-slugs-scroller');
    // jsdom has no layout: fake a strip that is twice as wide as its viewport.
    Object.defineProperty(scroller, 'scrollWidth', {
      value: 600,
      configurable: true,
    });
    Object.defineProperty(scroller, 'clientWidth', {
      value: 300,
      configurable: true,
    });
    const scrollBy = vi.fn();
    Object.defineProperty(scroller, 'scrollBy', {
      value: scrollBy,
      configurable: true,
    });
    fireEvent.scroll(scroller);

    const right = await screen.findByLabelText('Scroll slugs right');
    // (no jest-dom in this project — assert on the DOM property)
    expect(
      (screen.getByLabelText('Scroll slugs left') as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(right);
    expect(scrollBy).toHaveBeenCalledWith({ left: 240, behavior: 'smooth' });

    // After scrolling, the left arrow becomes available and the right one goes.
    Object.defineProperty(scroller, 'scrollLeft', {
      value: 300,
      configurable: true,
    });
    fireEvent.scroll(scroller);
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Scroll slugs left') as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByLabelText('Scroll slugs right') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
