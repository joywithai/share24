// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Vitest runs without globals here, so register Testing Library's cleanup
// manually (it normally hooks into the global afterEach).
afterEach(cleanup);

import { ExpiryCountdown } from '@/components/share/ExpiryCountdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('renders its label and handles clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Create share</Button>);
    const button = screen.getByRole('button', { name: 'Create share' });
    await fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire clicks when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Create share
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Create share' });
    await fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is a real form button by default', () => {
    render(<Button>Submit me</Button>);
    // type="button" is the safe default (prevents accidental form submits)
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });
});

describe('Badge', () => {
  it('renders its content', () => {
    render(<Badge variant="success">active</Badge>);
    expect(screen.getByText('active')).toBeTruthy();
  });
});

describe('ExpiryCountdown', () => {
  it('shows "Expired" for a past date', () => {
    render(
      <ExpiryCountdown expiresAt={new Date(Date.now() - 1000).toISOString()} />,
    );
    expect(screen.getByText('Expired')).toBeTruthy();
  });

  it('shows a countdown for a future date', () => {
    render(
      <ExpiryCountdown
        expiresAt={new Date(Date.now() + 90 * 60_000).toISOString()}
      />,
    );
    expect(screen.getByText(/Expires in \d+h \d+m/)).toBeTruthy();
  });

  it('ticks forward over time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T12:00:00.000Z'));
    render(
      <ExpiryCountdown
        expiresAt={new Date('2026-09-24T12:09:00.000Z').toISOString()}
      />,
    );
    expect(screen.getByText(/Expires in 9m \d+s/)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText(/Expires in 8m \d+s/)).toBeTruthy();
    vi.useRealTimers();
  });
});
