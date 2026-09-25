'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import {
  createCodeShare,
  routeStatus,
  type ShareResult,
} from '@/app/actions/share';
import { PinInput } from '@/components/share/PinInput';
import {
  type RouteAvailability,
  RouteField,
} from '@/components/share/RouteField';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { normalizeRoute } from '@/lib/route';
import { type CodeShareInput, codeShareSchema } from '@/lib/schemas';

const CodeEditor = dynamic(
  () => import('@/components/editor/CodeEditor').then((mod) => mod.CodeEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[420px] items-center justify-center rounded-lg border border-line bg-bg font-mono text-sm text-sub">
        Loading editor…
      </div>
    ),
  },
);

/**
 * /create/code — Client Component: interactive Monaco editor, React Hook Form
 * state, Zod validation (client pass), then the `createCodeShare` server
 * action (which re-validates everything server-side).
 */
export default function CreateCodePage() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CodeShareInput>({
    resolver: zodResolver(codeShareSchema),
    defaultValues: { code: '', route: '', pin: '' },
  });

  const code = watch('code');

  const [availability, setAvailability] = useState<RouteAvailability>('idle');
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Debounced live check: ✓ free / ✕ taken while the user types the slug. */
  function handleRouteChange(value: string) {
    if (checkTimer.current) clearTimeout(checkTimer.current);
    if (!value.trim()) {
      setAvailability('idle');
      return;
    }
    setAvailability('checking');
    checkTimer.current = setTimeout(() => {
      routeStatus(value)
        .then((result) => {
          setAvailability(result.state === 'invalid' ? 'idle' : result.state);
        })
        .catch(() => setAvailability('idle'));
    }, 250);
  }

  const onSubmit = handleSubmit(async (values) => {
    setPending(true);
    setSubmitError(null);
    const result = (await createCodeShare({
      ...values,
      route: normalizeRoute(values.route),
    })) as ShareResult;
    setPending(false);

    if (result.ok && result.route) {
      router.push(`/${result.route}`);
      router.refresh();
      return;
    }
    setSubmitError(result.error ?? 'Something went wrong.');
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Share code</h1>
        <p className="mt-1 text-sm text-sub">
          Paste or write code, name the route, get a link that dies in 24 hours.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <Card>
          <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="route">Route</Label>
              <RouteField
                id="route"
                placeholder="my-snippet"
                availability={availability}
                onValueChange={handleRouteChange}
                {...register('route')}
              />
              {errors.route ? (
                <p role="alert" className="text-xs text-danger">
                  {errors.route.message}
                </p>
              ) : (
                <p className="text-xs text-sub/70">
                  3–50 chars · a–z, 0–9, - and _ only
                </p>
              )}
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="pin">
                PIN <span className="font-normal text-sub/60">(optional)</span>
              </Label>
              <Controller
                control={control}
                name="pin"
                render={({ field }) => (
                  <PinInput
                    id="pin"
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    invalid={Boolean(errors.pin)}
                    describedBy={errors.pin ? 'pin-error' : 'pin-hint'}
                  />
                )}
              />
              {errors.pin ? (
                <p id="pin-error" role="alert" className="text-xs text-danger">
                  {errors.pin.message}
                </p>
              ) : (
                <p id="pin-hint" className="text-xs text-sub/70">
                  Viewers must enter this PIN to open the share.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Code</CardTitle>
            <CardDescription>
              Plain text in V1 — no language detection yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeEditor
              value={code}
              onChange={(next) =>
                setValue('code', next, { shouldValidate: true })
              }
              ariaLabel="Code to share"
            />
            {errors.code && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {errors.code.message}
              </p>
            )}
          </CardContent>
        </Card>

        {submitError && (
          <p role="alert" className="text-sm text-danger">
            {submitError}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-sub">
            Self-destructs 24 hours after creation.
          </p>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? 'Creating…' : 'Create share'}
          </Button>
        </div>
      </form>
    </div>
  );
}
