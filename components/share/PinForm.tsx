'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';

import { verifyPinAction } from '@/app/actions/share';
import { ExpiryCountdown } from '@/components/share/ExpiryCountdown';
import { PinInput } from '@/components/share/PinInput';
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
  const [pin, setPin] = useState('');
  const [focusRequest, setFocusRequest] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
    }
  }, [state.ok, router]);

  // A refused attempt empties the boxes and puts the caret back in the first
  // empty one, ready for the next try.
  const refused = Boolean(state.error) || Boolean(state.expired);
  useEffect(() => {
    if (!refused) return;
    setPin('');
    setFocusRequest((count) => count + 1);
  }, [refused]);

  // Four digits in — no need for a separate "Unlock" click. The effect runs
  // after the value is committed to the DOM, so the hidden input posts the
  // full PIN.
  useEffect(() => {
    if (pin.length < 4 || pending) return;
    formRef.current?.requestSubmit();
  }, [pin, pending]);

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
            <form ref={formRef} action={formAction} className="space-y-4">
              <input type="hidden" name="shareId" value={shareId} />
              <input type="hidden" name="route" value={route} />
              <div className="space-y-2">
                <Label htmlFor="pin" className="block text-center">
                  Enter the 4-digit PIN
                </Label>
                <div className="flex justify-center">
                  <PinInput
                    name="pin"
                    value={pin}
                    onChange={setPin}
                    disabled={pending}
                    invalid={Boolean(state.error)}
                    // Deliberate: the PIN gate is a single-field form — focusing
                    // it instantly removes a click for keyboard users.
                    autoFocus
                    focusRequest={focusRequest}
                  />
                </div>
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
