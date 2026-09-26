import { S3Client } from '@aws-sdk/client-s3';

import {
  isSafeShareId,
  isSafeStorageKey,
  storageKeyFor,
  storedNameFor,
} from '@/lib/storage/naming';
import {
  assertKey,
  B2_BACKEND,
  deleteFile,
  deleteMultiple,
  downloadFile,
  fileExists,
  listKeys,
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

/**
 * Backblaze B2 storage, through its S3-compatible endpoint.
 *
 *     B2_ENDPOINT           s3.us-east-005.backblazeb2.com   (scheme optional)
 *     B2_KEY_ID             0042ab0000000000000000001
 *     B2_APPLICATION_KEY    the application key for that id
 *     B2_BUCKET_NAME        sharede
 *     B2_REGION             us-east-005
 *
 * Two things differ from R2 and are worth knowing before debugging an upload:
 *
 *   - **B2 buckets are regional**, so the endpoint and the region must match
 *     the bucket (`s3.us-east-005.backblazeb2.com` + `us-east-005`). A wrong
 *     region is a signature error, not a 404.
 *   - **The endpoint may carry a scheme.** In production it does not
 *     (`s3.us-east-005.backblazeb2.com`); a full `http://127.0.0.1:9000` form
 *     is accepted so the same provider can be pointed at a local
 *     S3-compatible server in tests and on a private network.
 *
 * Objects are named exactly like local files and R2 objects
 * (`<shareId>/<nn>-<name>`), so a bucket dump stays readable and switching
 * providers never orphans a share.
 */

export interface B2Config {
  endpoint: string;
  bucket: string;
  keyId: string;
  applicationKey: string;
  region: string;
  /** Local S3 servers (MinIO and friends) need path-style addressing. */
  forcePathStyle: boolean;
}

const REQUIRED_ENV = [
  'B2_ENDPOINT',
  'B2_KEY_ID',
  'B2_APPLICATION_KEY',
  'B2_BUCKET_NAME',
] as const;

/** B2 hands out a bare host; the SDK wants a URL. */
export function b2Endpoint(rawEndpoint: string): string {
  const trimmed = rawEndpoint.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function readB2Config(
  env: Record<string, string | undefined> = process.env,
): B2Config {
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new StorageConfigError(
      `B2 storage is selected but ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } not set. Fill them in or switch back with STORAGE_TYPE=LOCAL.`,
      { code: 'b2_env_missing' },
    );
  }

  return {
    endpoint: b2Endpoint(env.B2_ENDPOINT as string),
    bucket: (env.B2_BUCKET_NAME as string).trim(),
    keyId: (env.B2_KEY_ID as string).trim(),
    applicationKey: (env.B2_APPLICATION_KEY as string).trim(),
    // B2 only cares that the region matches the bucket's own region.
    region: env.B2_REGION?.trim() || 'us-east-005',
    forcePathStyle:
      (env.B2_FORCE_PATH_STYLE ?? '').trim().toLowerCase() === 'true' ||
      // A local endpoint (an S3 clone on a private network) is almost always
      // path-style; requiring the flag for those would be a footgun.
      /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(
        b2Endpoint(env.B2_ENDPOINT as string),
      ),
  };
}

export function createB2Client(config: B2Config): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.keyId,
      secretAccessKey: config.applicationKey,
    },
  });
}

export class B2StorageProvider implements StorageProvider {
  readonly type = 'B2' as const;

  constructor(
    private readonly client: S3Client,
    private readonly config: B2Config,
  ) {}

  /**
   * Builds the provider from the environment (`STORAGE_TYPE=B2`). An explicit
   * client can be handed in — tests replace the network with a recorder.
   */
  static fromEnv(
    env: Record<string, string | undefined> = process.env,
    client?: S3Client,
  ): B2StorageProvider {
    const config = readB2Config(env);
    return new B2StorageProvider(client ?? createB2Client(config), config);
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
          B2_BACKEND,
        );
        locations.push({
          storedPath: key,
          storageType: 'B2',
          // The object columns keep their historical names (`r2Key`,
          // `r2Bucket`) — they hold the key and bucket for any S3-compatible
          // provider, and renaming them would need a migration for no gain.
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
        B2_BACKEND,
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
      B2_BACKEND,
    );
  }

  async exists(file: StorageFileRef): Promise<boolean> {
    return fileExists(
      this.client,
      this.bucketOf(file),
      this.keyOf(file),
      B2_BACKEND,
    );
  }

  async delete(file: StorageFileRef): Promise<void> {
    await deleteFile(
      this.client,
      this.bucketOf(file),
      this.keyOf(file),
      B2_BACKEND,
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
      B2_BACKEND,
    );
    await deleteMultiple(this.client, this.config.bucket, keys, B2_BACKEND);
  }

  /** The key of a row: the object column, falling back to the mirrored path. */
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

/** Exported so a caller can recognise a B2 key without importing the SDK. */
export function isB2Key(key: string): boolean {
  return isSafeStorageKey(key);
}
