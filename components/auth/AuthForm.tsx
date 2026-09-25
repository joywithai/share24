'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** One schema for both modes — `name` is only required for sign-up (checked
 * in the submit handler, where the current mode is known). */
const schema = z.object({
  name: z.string().optional(),
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

type AuthInput = z.infer<typeof schema>;

interface AuthFormProps {
  /** Where to go after a successful sign-in/sign-up. */
  redirectTarget: string;
}

/**
 * Login + sign-up form. Both modes share one component; Better Auth's
 * /api/auth endpoints do the actual work (password hashing lives in the
 * Account table, sessions in the Session table).
 */
export function AuthForm({ redirectTarget }: AuthFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isSignup = mode === 'signup';

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AuthInput>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '' },
  });

  function switchMode(next: 'login' | 'signup') {
    setMode(next);
    setFormError(null);
    reset();
  }

  const onSubmit = handleSubmit(async (values) => {
    if (isSignup && !values.name?.trim()) {
      setFormError('Tell us what to call you.');
      return;
    }

    setPending(true);
    setFormError(null);

    const endpoint = isSignup
      ? '/api/auth/sign-up/email'
      : '/api/auth/sign-in/email';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isSignup
            ? {
                name: values.name,
                email: values.email,
                password: values.password,
              }
            : { email: values.email, password: values.password },
        ),
      });

      if (!res.ok) {
        let message = 'Something went wrong — please try again.';
        try {
          const body = (await res.json()) as { message?: string };
          if (body?.message) message = body.message;
        } catch {
          // non-JSON error body — keep the default message
        }
        setFormError(message);
        return;
      }

      router.push(redirectTarget);
      router.refresh();
    } catch {
      setFormError('Could not reach the server — please try again.');
    } finally {
      setPending(false);
    }
  });

  return (
    <div className="mx-auto max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {isSignup ? 'Create an account' : 'Welcome back'}
          </CardTitle>
          <CardDescription>
            Optional — Sharetofnd works fine without an account. Signing in lets
            you see all your shares on one page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-line bg-bg p-1">
            {(['login', 'signup'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  mode === m
                    ? 'bg-card-soft text-fg'
                    : 'text-sub hover:text-fg',
                )}
              >
                {m === 'login' ? 'Log in' : 'Sign up'}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {isSignup && (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="Ada Lovelace"
                  {...register('name')}
                />
                {errors.name && (
                  <p role="alert" className="text-xs text-danger">
                    {errors.name.message}
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                {...register('email')}
              />
              {errors.email && (
                <p role="alert" className="text-xs text-danger">
                  {errors.email.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder={
                  isSignup ? 'At least 8 characters' : 'Your password'
                }
                {...register('password')}
              />
              {errors.password && (
                <p role="alert" className="text-xs text-danger">
                  {errors.password.message}
                </p>
              )}
            </div>

            {formError && (
              <p role="alert" className="text-sm text-danger">
                {formError}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={pending}>
              {pending
                ? 'Please wait…'
                : isSignup
                  ? 'Create account'
                  : 'Log in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
