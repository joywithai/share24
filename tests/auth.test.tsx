// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthForm } from '@/components/auth/AuthForm';

afterEach(cleanup);

// The real implementation calls `window.location.assign`, which jsdom refuses
// to let a test replace — so the module is mocked instead.
const hardNavigate = vi.fn();
vi.mock('@/lib/navigate', () => ({
  hardNavigate: (to: string) => hardNavigate(to),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  hardNavigate.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

/** The form's submit button — the mode tabs share their label with it. */
function submitButton(): HTMLElement {
  const button = screen
    .getAllByRole('button')
    .find((element) => element.getAttribute('type') === 'submit');
  if (!button) throw new Error('no submit button rendered');
  return button;
}

function fillIn({
  email = 'demo@sharetofnd.dev',
  password = 'password123',
}: {
  email?: string;
  password?: string;
} = {}) {
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: password },
  });
}

describe('AuthForm', () => {
  it('sends the visitor to the redirect target after a successful login', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'abc', user: { id: 'u1' } }),
    });
    render(<AuthForm redirectTarget="/profile" />);

    fillIn();
    fireEvent.click(submitButton());

    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/profile'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/sign-in/email',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('honours the `next` target it was given', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<AuthForm redirectTarget="/create/code" />);

    fillIn();
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(hardNavigate).toHaveBeenCalledWith('/create/code'),
    );
  });

  it('shows the server error and stays put when the credentials are wrong', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Invalid email or password' }),
    });
    render(<AuthForm redirectTarget="/profile" />);

    fillIn({ password: 'wrong-password' });
    fireEvent.click(submitButton());

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Invalid email or password',
    );
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it('posts a new account to the sign-up endpoint, name included', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<AuthForm redirectTarget="/profile" />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Ada Lovelace' },
    });
    fillIn({ email: 'ada@example.com', password: 'password123' });
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/sign-up/email',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });
    expect(hardNavigate).toHaveBeenCalledWith('/profile');
  });

  it('asks for a name before creating an account', async () => {
    render(<AuthForm redirectTarget="/profile" />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    fillIn({ email: 'ada@example.com', password: 'password123' });
    fireEvent.click(submitButton());

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Tell us what to call you.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a network failure instead of navigating', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<AuthForm redirectTarget="/profile" />);

    fillIn();
    fireEvent.click(submitButton());

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not reach the server',
    );
    expect(hardNavigate).not.toHaveBeenCalled();
  });
});
