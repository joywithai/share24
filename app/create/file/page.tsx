'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { createFileShare, type ShareResult } from '@/app/actions/share';
import { FileDrop } from '@/components/file/FileDrop';
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

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FileShareInput>({
    resolver: zodResolver(fileShareSchema),
    defaultValues: { route: '', pin: '' },
  });

  const route = watch('route');

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
          Drop a file, pick a route, get a download link that dies in 24 hours.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">File</CardTitle>
            <CardDescription>
              PNG, JPG, WEBP, PDF, TXT, DOC, DOCX — up to 10 MB.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FileDrop file={file} onFile={handleFile} error={fileError} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="route">Route</Label>
              <Input id="route" placeholder="my-file" {...register('route')} />
              {errors.route ? (
                <p role="alert" className="text-xs text-danger">
                  {errors.route.message}
                </p>
              ) : route ? (
                <p className="text-xs text-sub">
                  Your link:{' '}
                  <span className="font-mono text-accent">
                    /{normalizeRoute(route)}
                  </span>
                </p>
              ) : (
                <p className="text-xs text-sub/70">
                  3–50 chars · a–z, 0–9, - and _ only
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="pin">
                PIN <span className="font-normal text-sub/60">(optional)</span>
              </Label>
              <Input
                id="pin"
                inputMode="numeric"
                maxLength={4}
                placeholder="4 digits"
                {...register('pin')}
              />
              {errors.pin ? (
                <p role="alert" className="text-xs text-danger">
                  {errors.pin.message}
                </p>
              ) : (
                <p className="text-xs text-sub/70">
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
