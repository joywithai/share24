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
import { filesProblem, MAX_FILES_PER_SHARE } from '@/lib/file';
import { rememberSlug } from '@/lib/recent-slugs';
import { normalizeRoute } from '@/lib/route';
import { type FileShareInput, fileShareSchema } from '@/lib/schemas';

/**
 * /create/file — Client Component: drag-and-drop upload of a whole set (1–10
 * files) with instant client validation, then the `createFileShare` server
 * action (which re-validates type, size, count and route availability
 * server-side).
 */
export default function CreateFilePage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
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

  function handleFiles(next: File[]) {
    setFiles(next);
    setFileError(next.length > 0 ? filesProblem(next) : null);
  }

  const onSubmit = handleSubmit(async (values) => {
    const issue = filesProblem(files);
    if (issue) {
      setFileError(issue);
      return;
    }

    setPending(true);
    setSubmitError(null);

    const formData = new FormData();
    for (const file of files) formData.append('files', file);
    formData.append('route', normalizeRoute(values.route));
    formData.append('pin', values.pin);

    const result = (await createFileShare(formData)) as ShareResult;
    setPending(false);

    if (result.ok && result.route) {
      // Keep the name for the "Your slugs" strip on the homepage, then land
      // there — the link is what the visitor needs next, and the strip copies
      // it in one click.
      rememberSlug(result.route);
      router.push('/');
      router.refresh();
      return;
    }
    setSubmitError(result.error ?? 'Something went wrong.');
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Share files</h1>
        <p className="mt-1 text-sm text-sub">
          Drop up to {MAX_FILES_PER_SHARE} files under one name and get a single
          link — they download together as a ZIP or one by one, and the whole
          thing dies in 24 hours.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        {/* Name and lock first: the route is what the visitor is sharing, and
            the "Create share" button lives here so it stays in view instead of
            sitting below the tall drop zone. */}
        <Card>
          <CardContent className="p-5">
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
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
              <div className="min-w-0 space-y-2 sm:w-52">
                <Label htmlFor="pin">
                  PIN{' '}
                  <span className="font-normal text-sub/60">(optional)</span>
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
                    Viewers must enter this PIN to download the files.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
              <p className="text-xs text-sub">
                {files.length === 0
                  ? 'Add your files below — then create the share.'
                  : 'Stored locally on this server and removed when the share expires.'}
              </p>
              <Button
                type="submit"
                size="lg"
                disabled={pending || files.length === 0 || fileError !== null}
              >
                {pending
                  ? 'Uploading…'
                  : files.length > 1
                    ? `Create share · ${files.length} files`
                    : 'Create share'}
              </Button>
            </div>

            {submitError && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {submitError}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Files</CardTitle>
            <CardDescription>
              1–{MAX_FILES_PER_SHARE} files, 10 MB each and 50 MB in total —
              archives, executables, web pages and video/audio are blocked.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FileDrop files={files} onFiles={handleFiles} error={fileError} />
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
