'use client';

import type { ReactNode } from 'react';
import { useActionState } from 'react';

/**
 * A `<form>` around an admin server action that shows what the server said.
 *
 * React 19's `useActionState` keeps the last result next to the form, so
 * "Suspended." or "Not allowed." appears where the operator clicked instead of
 * disappearing into the void. The message is wired to `aria-live` so it is
 * announced too.
 */

export interface AdminFormState {
  ok: boolean;
  error?: string;
  message?: string;
}

export function AdminForm({
  action,
  children,
  className = 'flex flex-wrap items-center gap-2',
}: {
  action: (formData: FormData) => Promise<AdminFormState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(
    async (_previous: AdminFormState | null, formData: FormData) =>
      action(formData),
    null,
  );

  return (
    <form action={formAction} className={className}>
      {children}
      {state ? (
        <span
          role="status"
          aria-live="polite"
          className={`text-xs ${state.ok ? 'text-ok' : 'text-danger'}`}
        >
          {state.ok ? state.message : state.error}
        </span>
      ) : null}
    </form>
  );
}
