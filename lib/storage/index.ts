import { B2StorageProvider } from '@/lib/storage/b2';
import { localStorageProvider } from '@/lib/storage/local';
import { R2StorageProvider } from '@/lib/storage/r2';
import {
  StorageConfigError,
  type StorageFileRef,
  type StorageProvider,
  type StorageType,
} from '@/lib/storage/types';

/**
 * The storage entry point.
 *
 * Three providers, one contract (`StorageProvider`):
 *
 *   - `LOCAL` — the local disk, the V1 default (`lib/storage/local.ts`).
 *   - `R2`    — a Cloudflare R2 bucket (`lib/storage/r2.ts`).
 *   - `B2`    — a Backblaze B2 bucket through its S3-compatible API
 *               (`lib/storage/b2.ts`). R2 and B2 share `lib/storage/s3.ts`.
 *
 * Which one is used has two separate answers, and keeping them apart is what
 * makes the switch safe:
 *
 *   - **New uploads** follow `STORAGE_TYPE` (default `LOCAL`) — `getStorageProvider()`.
 *   - **Existing files** are read with the provider recorded on their own row —
 *     `providerFor(file)`. So flipping `STORAGE_TYPE=R2` moves new uploads to
 *     the bucket while every share that is already on the disk keeps working.
 */

export * from '@/lib/storage/b2';
export * from '@/lib/storage/local';
export * from '@/lib/storage/naming';
export * from '@/lib/storage/r2';
export * from '@/lib/storage/s3';
export * from '@/lib/storage/types';

let r2Provider: R2StorageProvider | null = null;
let b2Provider: B2StorageProvider | null = null;

/** `STORAGE_TYPE`, defaulting to `LOCAL`. Throws on an unknown value. */
export function configuredStorageType(
  env: Record<string, string | undefined> = process.env,
): StorageType {
  const raw = (env.STORAGE_TYPE ?? 'LOCAL').trim().toUpperCase();
  if (raw === 'LOCAL' || raw === 'R2' || raw === 'B2') return raw;
  throw new StorageConfigError(
    `STORAGE_TYPE must be "LOCAL", "R2" or "B2" (got "${env.STORAGE_TYPE}")`,
    { code: 'bad_storage_type' },
  );
}

/**
 * The provider for new uploads, or for an explicit storage type. A bucket
 * provider is built (and its env validated) on first use, so a LOCAL
 * deployment never needs R2 or B2 credentials.
 */
export function getStorageProvider(
  type: StorageType = configuredStorageType(),
): StorageProvider {
  if (type === 'LOCAL') return localStorageProvider;
  if (type === 'B2') {
    b2Provider ??= B2StorageProvider.fromEnv();
    return b2Provider;
  }
  r2Provider ??= R2StorageProvider.fromEnv();
  return r2Provider;
}

/** The provider that owns an existing file's bytes. */
export function providerFor(file: StorageFileRef): StorageProvider {
  return getStorageProvider(file.storageType);
}

/**
 * The files whose bytes are really still there, in the order they were given.
 *
 * This fails the other way round from an expired share: the metadata is in the
 * database while the storage (a wiped uploads folder, deleted objects) is
 * empty. Checking before answering a download means a visitor gets an
 * explained page instead of a 0-byte archive — or a corrupt one.
 *
 * A provider that cannot be reached at all is reported as "not there" and
 * logged: one unreadable file must not take a whole share page down.
 */
export async function availableFiles<T extends StorageFileRef>(
  files: readonly T[],
): Promise<T[]> {
  const checks = await Promise.all(
    files.map(async (file) => {
      try {
        return await providerFor(file).exists(file);
      } catch (error) {
        console.warn(
          `[storage] could not check "${file.storedPath}" on ${file.storageType}`,
          error,
        );
        return false;
      }
    }),
  );
  return files.filter((_, index) => checks[index]);
}

/** Drops the memoised bucket providers — for tests, and after an env change. */
export function resetStorageProviders(): void {
  r2Provider = null;
  b2Provider = null;
}
