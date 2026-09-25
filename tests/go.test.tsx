// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Vitest runs without globals here, so register Testing Library's cleanup
// manually (it normally hooks into the global afterEach).
afterEach(cleanup);

const push = vi.fn();
const back = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back }),
}));

const { RouteGoBox, slugFromInput } = await import(
  '@/components/share/RouteGoBox'
);
const { GoBackButton } = await import('@/components/layout/GoBackButton');

beforeEach(() => {
  push.mockClear();
  back.mockClear();
});

describe('slugFromInput', () => {
  it('keeps a bare slug', () => {
    expect(slugFromInput('any-name')).toBe('any-name');
  });

  it('lowercases and trims', () => {
    expect(slugFromInput('  My-Snippet  ')).toBe('my-snippet');
  });

  it('strips a pasted share link', () => {
    expect(slugFromInput('https://sharetofnd.dev/hello-world')).toBe(
      'hello-world',
    );
    expect(slugFromInput('http://localhost:3000/hello-world/')).toBe(
      'hello-world',
    );
    expect(slugFromInput('http://localhost:3000/hello/world')).toBe('hello');
  });

  it('returns an empty string for junk', () => {
    expect(slugFromInput('   ')).toBe('');
    expect(slugFromInput('/')).toBe('');
    expect(slugFromInput('https://sharetofnd.dev/')).toBe('');
  });
});

describe('RouteGoBox', () => {
  it('navigates to the typed slug', async () => {
    render(<RouteGoBox />);
    await fireEvent.change(screen.getByLabelText('Share name'), {
      target: { value: 'any-name' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(push).toHaveBeenCalledWith('/any-name');
  });

  it('accepts a pasted link', async () => {
    render(<RouteGoBox />);
    await fireEvent.change(screen.getByLabelText('Share name'), {
      target: { value: 'https://sharetofnd.dev/hello-world' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(push).toHaveBeenCalledWith('/hello-world');
  });

  it('blocks an invalid slug and explains why', async () => {
    render(<RouteGoBox />);
    await fireEvent.change(screen.getByLabelText('Share name'), {
      target: { value: 'ab' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent?.includes('at least 3')).toBe(
      true,
    );
  });

  it('blocks a reserved word', async () => {
    render(<RouteGoBox />);
    await fireEvent.change(screen.getByLabelText('Share name'), {
      target: { value: 'login' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('reserved');
  });

  it('clears the error as soon as the name is edited again', async () => {
    render(<RouteGoBox />);
    const input = screen.getByLabelText('Share name');
    await fireEvent.change(input, { target: { value: 'ab' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.queryByRole('alert')).toBeTruthy();
    await fireEvent.change(input, { target: { value: 'abc' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('GoBackButton', () => {
  it('goes back through history when there is history', async () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
    render(<GoBackButton />);
    await fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('falls back to the homepage on a cold entry', async () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    render(<GoBackButton />);
    await fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(push).toHaveBeenCalledWith('/');
    expect(back).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
