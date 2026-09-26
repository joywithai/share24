import { type S3Client, S3Client as S3ClientCtor } from '@aws-sdk/client-s3';
import {
  isSafeShareId,
  isSafeStorageKey,
  storageKeyFor,
  storedNameFor,
} from '@/lib/storage/naming';
import {
  assertKey,
  deleteFile,
  deleteMultiple,
  downloadFile,
  fileExists,
  listKeys,
  R2_BACKEND,
  uploadFile,
} from '@/lib/storage/s3';
import {
  type IncomingFile,
  StorageConfigError,
  StorageError,
  type StorageFileRef,
  type StorageLocation,
  type StorageProvider,
} from '@/lib/storage/types';

// The S3 object helpers are shared with the B2 provider; they are re-exported
// here because `@/lib/storage` has always exposed them under these names.
export {
  assertKey,
  B2_BACKEND,
  deleteFile,
  deleteMultiple,
  downloadFile,
  fileExists,
  getSignedUrl,
  isNotFound,
  listKeys,
  R2_BACKEND,
  type S3Backend,
  uploadFile,
} from '@/lib/storage/s3';

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
  return new S3ClientCtor({
    // R2 has no regions; `auto` is what Cloudflare documents.
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
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
          R2_BACKEND,
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
        R2_BACKEND,
      ).catch(() => {});
      throw error;
    }
    return locations;
  }

  async get(file: StorageFileRef): Promise<Uint8Array | null> {
    return downloadFile(
      this.client,
      this.bucketOf(file),
      this.keyOf(file),
      R2_BACKEND,
    );
  }

  async exists(file: StorageFileRef): Promise<boolean> {
    return fileExists(
      this.client,
      this.bucketOf(file),
      this.keyOf(file),
      R2_BACKEND,
    );
  }

  async delete(file: StorageFileRef): Promise<void> {
    await deleteFile(
      this.client,
      this.bucketOf(file),
      this.keyOf(file),
      R2_BACKEND,
    );
  }

  async deleteShare(shareId: string): Promise<void> {
    if (!isSafeShareId(shareId)) {
      throw new StorageError(`Unsafe share id "${shareId}"`, {
        code: 'unsafe_share_id',
      });
    }
    const prefix = `${shareId}/`;
    const keys = await listKeys(
      this.client,
      this.config.bucket,
      prefix,
      R2_BACKEND,
    );
    await deleteMultiple(this.client, this.config.bucket, keys, R2_BACKEND);
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
