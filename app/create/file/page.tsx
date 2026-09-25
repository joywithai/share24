'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import {
  createFileShare,
  routeStatus,
  type ShareResult,
} from '@/app/actions/share';
import { FileDrop } from '@/components/file/FileDrop';
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
import { fileProblem } from '@/lib/file';
import { normalizeRoute } from '@/lib/route';
import { type FileShareInput, fileShareSchema } from '@/lib/schemas';

/**
 * /create/file — Client Component: drag-and-drop upload with instant client
 * validation, then the `createFileShare` server action (which re-validates
 * type, size and route availability server-side).
 */
export default function CreateFilePage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FileShareInput>({
    resolver: zodResolver(fileShareSchema),
    defaultValues: { route: '', pin: '' },
  });

  function handleFile(next: File | null) {
    setFile(next);
    setFileError(next ? fileProblem(next) : null);
  }

  const onSubmit = handleSubmit(async (values) => {
    if (!file) {
      setFileError('Choose a file to share.');
      return;
    }
    const issue = fileProblem(file);
    if (issue) {
      setFileError(issue);
      return;
    }

    setPending(true);
    setSubmitError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('route', normalizeRoute(values.route));
    formData.append('pin', values.pin);

    const result = (await createFileShare(formData)) as ShareResult;
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
        <h1 className="text-2xl font-semibold tracking-tight">Share a file</h1>
        <p className="mt-1 text-sm text-sub">
          Drop a file, name the route, get a download link that dies in 24
          hours.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">File</CardTitle>
            <CardDescription>
              Any single file up to 10 MB — archives, executables, web pages and
              video/audio are blocked.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FileDrop file={file} onFile={handleFile} error={fileError} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="route">Route</Label>
              <RouteField
                id="route"
                placeholder="my-file"
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
                    describedBy={
                      errors.pin ? 'file-pin-error' : 'file-pin-hint'
                    }
                  />
                )}
              />
              {errors.pin ? (
                <p
                  id="file-pin-error"
                  role="alert"
                  className="text-xs text-danger"
                >
                  {errors.pin.message}
                </p>
              ) : (
                <p id="file-pin-hint" className="text-xs text-sub/70">
                  Viewers must enter this PIN to download the file.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {submitError && (
          <p role="alert" className="text-sm text-danger">
            {submitError}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-sub">
            Stored locally on this server and removed when the share expires.
          </p>
          <Button
            type="submit"
            size="lg"
            disabled={pending || !file || fileError !== null}
          >
            {pending ? 'Uploading…' : 'Create share'}
          </Button>
        </div>
      </form>
    </div>
  );
}
