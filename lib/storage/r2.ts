import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presignUrl } from '@aws-sdk/s3-request-presigner';

import {
  isSafeShareId,
  isSafeStorageKey,
  storageKeyFor,
  storedNameFor,
} from '@/lib/storage/naming';
import {
  type IncomingFile,
  StorageConfigError,
  StorageError,
  type StorageFileRef,
  type StorageLocation,
  type StorageProvider,
} from '@/lib/storage/types';

/**
 * Cloudflare R2 (S3-compatible) storage.
 *
 * Four environment variables drive it, and nothing here runs unless
 * `STORAGE_TYPE=R2` in the app or the row being read says `R2`:
 *
 *     R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY  R2_BUCKET_NAME
 *
 * Objects are named exactly like local files (`<shareId>/<nn>-<name>`), which
 * makes a bucket dump readable and keeps the two providers interchangeable.
 * Downloads come through the app, so the bucket never needs to be public and
 * no CDN URL is involved.
 */

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
}

const REQUIRED_ENV = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
] as const;

/** The public endpoint of an account. No CDN, no custom domain. */
export function r2Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export function readR2Config(
  env: Record<string, string | undefined> = process.env,
): R2Config {
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new StorageConfigError(
      `R2 storage is selected but ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } not set. Fill them in or switch back with STORAGE_TYPE=LOCAL.`,
      { code: 'r2_env_missing' },
    );
  }

  const accountId = (env.R2_ACCOUNT_ID as string).trim();
  return {
    accountId,
    accessKeyId: (env.R2_ACCESS_KEY_ID as string).trim(),
    secretAccessKey: (env.R2_SECRET_ACCESS_KEY as string).trim(),
    bucket: (env.R2_BUCKET_NAME as string).trim(),
    endpoint: r2Endpoint(accountId),
  };
}

export function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    // R2 has no regions; `auto` is what Cloudflare documents.
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

/** 404-shaped errors mean "not there", not "broken". */
function isNotFound(error: unknown): boolean {
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

function assertKey(key: string): void {
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
    throw new StorageError(`R2 upload failed for ${key}`, {
      code: 'r2_upload_failed',
      cause: error,
    });
  }
}

/** The object's bytes, or `null` when the object is not in the bucket. */
export async function downloadFile(
  client: S3Client,
  bucket: string,
  key: string,
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
    throw new StorageError(`R2 download failed for ${key}`, {
      code: 'r2_download_failed',
      cause: error,
    });
  }
}

export async function deleteFile(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<void> {
  assertKey(key);
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    throw new StorageError(`R2 delete failed for ${key}`, {
      code: 'r2_delete_failed',
      cause: error,
    });
  }
}

/** Delete in batches — the S3 API takes at most 1000 keys per call. */
export async function deleteMultiple(
  client: S3Client,
  bucket: string,
  keys: readonly string[],
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
      throw new StorageError(`R2 batch delete failed (${batch.length} keys)`, {
        code: 'r2_delete_failed',
        cause: error,
      });
    }
  }
}

/** Every key under a prefix. Paged, because a listing is never complete. */
export async function listKeys(
  client: S3Client,
  bucket: string,
  prefix: string,
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
      throw new StorageError(`R2 listing failed for prefix ${prefix}`, {
        code: 'r2_list_failed',
        cause: error,
      });
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
): Promise<boolean> {
  assertKey(key);
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw new StorageError(`R2 head failed for ${key}`, {
      code: 'r2_head_failed',
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
      code: 'r2_sign_failed',
      cause: error,
    });
  }
}

export class R2StorageProvider implements StorageProvider {
  readonly type = 'R2' as const;

  constructor(
    private readonly client: S3Client,
    private readonly config: R2Config,
  ) {}

  /**
   * Builds the provider from the environment (`STORAGE_TYPE=R2`). An explicit
   * client can be handed in — tests replace the network with a recorder.
   */
  static fromEnv(
    env: Record<string, string | undefined> = process.env,
    client?: S3Client,
  ): R2StorageProvider {
    const config = readR2Config(env);
    return new R2StorageProvider(client ?? createR2Client(config), config);
  }

  async save(
    shareId: string,
    files: readonly IncomingFile[],
  ): Promise<StorageLocation[]> {
    const locations: StorageLocation[] = [];
    try {
      for (const file of files) {
        const key = storageKeyFor(
          shareId,
          storedNameFor(file.position, file.fileName),
        );
        await uploadFile(
          this.client,
          this.config.bucket,
          key,
          await file.bytes(),
          file.mimeType,
        );
        locations.push({
          storedPath: key,
          storageType: 'R2',
          r2Key: key,
          r2Bucket: this.config.bucket,
        });
      }
    } catch (error) {
      // Half a set in the bucket is worse than none: remove what went up.
      await deleteMultiple(
        this.client,
        this.config.bucket,
        locations.map((location) => location.storedPath),
      ).catch(() => {});
      throw error;
    }
    return locations;
  }

  async get(file: StorageFileRef): Promise<Uint8Array | null> {
    return downloadFile(this.client, this.bucketOf(file), this.keyOf(file));
  }

  async exists(file: StorageFileRef): Promise<boolean> {
    return fileExists(this.client, this.bucketOf(file), this.keyOf(file));
  }

  async delete(file: StorageFileRef): Promise<void> {
    await deleteFile(this.client, this.bucketOf(file), this.keyOf(file));
  }

  async deleteShare(shareId: string): Promise<void> {
    if (!isSafeShareId(shareId)) {
      throw new StorageError(`Unsafe share id "${shareId}"`, {
        code: 'unsafe_share_id',
      });
    }
    const prefix = `${shareId}/`;
    const keys = await listKeys(this.client, this.config.bucket, prefix);
    await deleteMultiple(this.client, this.config.bucket, keys);
  }

  /** The key of a row: the R2 column, falling back to the mirrored path. */
  private keyOf(file: StorageFileRef): string {
    const key = (file.r2Key ?? file.storedPath ?? '').trim();
    assertKey(key);
    return key;
  }

  /** A row remembers its bucket, so a bucket change cannot orphan old files. */
  private bucketOf(file: StorageFileRef): string {
    return file.r2Bucket?.trim() || this.config.bucket;
  }
}
