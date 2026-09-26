'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';

/**
 * A submit button for a `<form action={serverAction}>` that can ask for
 * confirmation first, and shows that the work is in flight.
 *
 * Destructive admin actions (delete a share, suspend an account) are one click
 * away from being a mistake — a `confirm()` in front of them is crude, but it
 * is honest and it works with keyboard and screen readers.
 */
export function ActionButton({
  children,
  confirm,
  variant = 'secondary',
  size = 'sm',
  name,
  value,
  className,
}: {
  children: ReactNode;
  confirm?: string;
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  name?: string;
  value?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      name={name}
      value={value}
      className={className}
      disabled={pending}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {pending ? '…' : children}
    </Button>
  );
}
