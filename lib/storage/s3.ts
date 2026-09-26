import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presignUrl } from '@aws-sdk/s3-request-presigner';

import { isSafeStorageKey } from '@/lib/storage/naming';
import { StorageError } from '@/lib/storage/types';

/**
 * The object operations shared by every S3-compatible provider.
 *
 * Cloudflare R2 and Backblaze B2 speak the same API, so the only difference is
 * the label a failure carries (`R2 upload failed …` vs `B2 upload failed …`) —
 * an operator reading a log should know which bucket to look in. Both
 * providers use these functions; neither reimplements them.
 */

export interface S3Backend {
  /** `R2` or `B2` — used in error messages and codes. */
  label: string;
  /** Lowercase prefix for error codes: `r2_upload_failed`, `b2_upload_failed`. */
  code: string;
}

export const R2_BACKEND: S3Backend = { label: 'R2', code: 'r2' };
export const B2_BACKEND: S3Backend = { label: 'B2', code: 'b2' };

/** 404-shaped errors mean "not there", not "broken". */
export function isNotFound(error: unknown): boolean {
  const candidate = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  } | null;
  const name = candidate?.name ?? candidate?.Code ?? '';
  return (
    name === 'NoSuchKey' ||
    name === 'NotFound' ||
    candidate?.$metadata?.httpStatusCode === 404
  );
}

/** Every key that reaches the SDK is checked first — no `../`, no surprises. */
export function assertKey(key: string): void {
  if (!isSafeStorageKey(key)) {
    throw new StorageError(`Unsafe object key "${key}"`, {
      code: 'unsafe_object_key',
    });
  }
}

export async function uploadFile(
  client: S3Client,
  bucket: string,
  key: string,
  bytes: Uint8Array,
  contentType: string,
  backend: S3Backend = R2_BACKEND,
): Promise<void> {
  assertKey(key);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  } catch (error) {
    throw new StorageError(`${backend.label} upload failed for ${key}`, {
      code: `${backend.code}_upload_failed`,
      cause: error,
    });
  }
}

/** The object's bytes, or `null` when the object is not in the bucket. */
export async function downloadFile(
  client: S3Client,
  bucket: string,
  key: string,
  backend: S3Backend = R2_BACKEND,
): Promise<Uint8Array | null> {
  assertKey(key);
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!result.Body) return null;
    return new Uint8Array(await result.Body.transformToByteArray());
  } catch (error) {
    if (isNotFound(error)) return null;
    throw new StorageError(`${backend.label} download failed for ${key}`, {
      code: `${backend.code}_download_failed`,
      cause: error,
    });
  }
}

export async function deleteFile(
  client: S3Client,
  bucket: string,
  key: string,
  backend: S3Backend = R2_BACKEND,
): Promise<void> {
  assertKey(key);
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    throw new StorageError(`${backend.label} delete failed for ${key}`, {
      code: `${backend.code}_delete_failed`,
      cause: error,
    });
  }
}

/** Delete in batches — the S3 API takes at most 1000 keys per call. */
export async function deleteMultiple(
  client: S3Client,
  bucket: string,
  keys: readonly string[],
  backend: S3Backend = R2_BACKEND,
): Promise<void> {
  for (const key of keys) assertKey(key);
  for (let index = 0; index < keys.length; index += 1000) {
    const batch = keys.slice(index, index + 1000);
    if (batch.length === 0) continue;
    try {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    } catch (error) {
      throw new StorageError(
        `${backend.label} batch delete failed (${batch.length} keys)`,
        { code: `${backend.code}_delete_failed`, cause: error },
      );
    }
  }
}

/** Every key under a prefix. Paged, because a listing is never complete. */
export async function listKeys(
  client: S3Client,
  bucket: string,
  prefix: string,
  backend: S3Backend = R2_BACKEND,
): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;

  do {
    let page: ListObjectsV2CommandOutput;
    try {
      page = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
    } catch (error) {
      throw new StorageError(
        `${backend.label} listing failed for prefix ${prefix}`,
        { code: `${backend.code}_list_failed`, cause: error },
      );
    }
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  return keys;
}

export async function fileExists(
  client: S3Client,
  bucket: string,
  key: string,
  backend: S3Backend = R2_BACKEND,
): Promise<boolean> {
  assertKey(key);
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw new StorageError(`${backend.label} head failed for ${key}`, {
      code: `${backend.code}_head_failed`,
      cause: error,
    });
  }
}

/** A temporary, signed GET URL — for tooling and future direct downloads. */
export async function getSignedUrl(
  client: S3Client,
  bucket: string,
  key: string,
  expiresInSeconds = 3600,
  backend: S3Backend = R2_BACKEND,
): Promise<string> {
  assertKey(key);
  try {
    return await presignUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  } catch (error) {
    throw new StorageError(`Could not sign ${key}`, {
      code: `${backend.code}_sign_failed`,
      cause: error,
    });
  }
}
