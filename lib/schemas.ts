import { z } from 'zod';

import { fileProblem, MAX_FILE_BYTES } from './file';
import { routeProblem } from './route';

/**
 * PIN rule: exactly 4 digits. Defined here (a pure module — imported by
 * client components) instead of `lib/pin.ts`, which uses node:crypto and
 * bcrypt and is server-only.
 */
export const PIN_REGEX = /^\d{4}$/;

export function isValidPin(pin: string): boolean {
  return PIN_REGEX.test(pin);
}

/**
 * Zod schemas shared by client-side validation (React Hook Form) and
 * server-side re-validation inside Server Actions.
 */

/** Hard cap on code/text content size (200 KB). */
export const MAX_CODE_CHARS = 200_000;

export const routeSchema = z
  .string()
  .min(1, 'Pick a route for your share.')
  .refine(
    (value) => routeProblem(value) === null,
    (value) => ({ message: routeProblem(value) ?? 'Invalid route.' }),
  );

export const pinSchema = z
  .string()
  .refine(
    (value) => value === '' || isValidPin(value),
    'PIN must be exactly 4 digits.',
  );

export const codeShareSchema = z.object({
  code: z
    .string()
    .min(1, 'Paste some code or text first.')
    .max(MAX_CODE_CHARS, 'Content is too long (200 KB max).'),
  route: routeSchema,
  pin: pinSchema,
});

export const fileShareSchema = z.object({
  route: routeSchema,
  pin: pinSchema,
});

export const fileUploadSchema = z.object({
  name: z.string().min(1, 'Choose a file first.'),
  type: z.string(),
  size: z
    .number()
    .int('File size is invalid.')
    .positive('That file is empty.')
    .max(
      MAX_FILE_BYTES,
      `Files must be ${MAX_FILE_BYTES / (1024 * 1024)} MB or smaller.`,
    )
    .refine((size) => size > 0, 'That file is empty.'),
});

export type CodeShareInput = z.infer<typeof codeShareSchema>;
export type FileShareInput = z.infer<typeof fileShareSchema>;

/** Convenience: full client-side file check (type + size + mime sanity). */
export function describeFileProblem(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  return fileProblem(file);
}
