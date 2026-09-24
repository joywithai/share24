'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';

import { verifyPinAction } from '@/app/actions/share';
import { ExpiryCountdown } from '@/components/share/ExpiryCountdown';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';

interface PinFormProps {
  shareId: string;
  route: string;
  expiresAt: string;
}

/**
 * PIN gate for protected shares. Submits the `verifyPinAction` server action;
 * on success the server sets a short-lived unlock cookie and the page
 * re-renders to reveal the content.
 */
export function PinForm({ shareId, route, expiresAt }: PinFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(verifyPinAction, {
    ok: false,
  });

  useEffect(() => {
    if (state.ok) {
      router.refresh();
    }
  }, [state.ok, router]);

  return (
    <div className="mx-auto max-w-sm">
      <Card>
        <CardHeader className="items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="h-6 w-6"
            >
              <rect x="4" y="10" width="16" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
            </svg>
          </span>
          <CardTitle className="text-center">
            {state.expired ? 'This share has expired' : 'PIN required'}
          </CardTitle>
          <CardDescription className="text-center">
            {state.expired ? (
              'It lived for 24 hours, as promised.'
            ) : (
              <>
                The author locked{' '}
                <span className="font-mono text-fg">/{route}</span> behind a
                4-digit PIN. <ExpiryCountdown expiresAt={expiresAt} />.
              </>
            )}
          </CardDescription>
        </CardHeader>
        {!state.expired && (
          <CardContent>
            <form action={formAction} className="space-y-4">
              <input type="hidden" name="shareId" value={shareId} />
              <input type="hidden" name="route" value={route} />
              <div className="space-y-2">
                <Label htmlFor="pin" className="block text-center">
                  Enter the 4-digit PIN
                </Label>
                <input
                  id="pin"
                  name="pin"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  required
                  // Deliberate: the PIN gate is a single-field form — focusing
                  // it instantly removes a click for keyboard users.
                  // biome-ignore lint/a11y/noAutofocus: intentional single-field focus
                  autoFocus
                  placeholder="····"
                  className="h-14 w-full rounded-md border border-line bg-bg px-3 text-center font-mono text-2xl tracking-[0.7em] text-fg placeholder:text-sub/40 focus-visible:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                />
              </div>
              {state.error && (
                <p role="alert" className="text-center text-sm text-danger">
                  {state.error}
                </p>
              )}
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? 'Checking…' : 'Unlock'}
              </Button>
            </form>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
