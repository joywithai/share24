/**
 * The storage contract.
 *
 * V1 wrote uploads straight to the local disk. Every place that touches bytes
 * now goes through a `StorageProvider` instead, so the app can keep its files
 * on the disk (default) or in a Cloudflare R2 bucket without the share code,
 * the download routes or the ZIP writer knowing which one it is.
 */

/** Where a file's bytes live. Mirrors the `StorageType` enum in the schema. */
export type StorageType = 'LOCAL' | 'R2';

/** A storage operation failed in a way the caller cannot paper over. */
export class StorageError extends Error {
  readonly code: string;

  constructor(
    message: string,
    options: { code?: string; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'StorageError';
    this.code = options.code ?? 'storage_error';
  }
}

/** The provider is missing what it needs (env vars, a usable row). */
export class StorageConfigError extends StorageError {
  constructor(
    message: string,
    options: { code?: string; cause?: unknown } = {},
  ) {
    super(message, { ...options, code: options.code ?? 'storage_config' });
    this.name = 'StorageConfigError';
  }
}

/**
 * A file the caller wants stored. The bytes are fetched through `bytes()`
 * *at write time*, so a 10-file / 50 MB share never has to sit in memory as
 * a whole — the provider writes one file, then asks for the next one.
 */
export interface IncomingFile {
  /** The name the file had on the author's device. */
  fileName: string;
  /** Order the author picked it in (0-based). */
  position: number;
  mimeType: string;
  fileSize: number;
  bytes: () => Promise<Uint8Array>;
}

/** Where a stored file ended up — the storage half of a `ShareFile` row. */
export interface StorageLocation {
  /** Local: path relative to the uploads root. R2: a copy of the object key. */
  storedPath: string;
  storageType: StorageType;
  r2Key: string | null;
  r2Bucket: string | null;
}

/** The storage columns of an existing `ShareFile` row. */
export interface StorageFileRef {
  storedPath: string;
  storageType: StorageType;
  r2Key: string | null;
  r2Bucket: string | null;
}

export interface StorageProvider {
  readonly type: StorageType;
  /** Store every file of a new share. All or nothing. */
  save(
    shareId: string,
    files: readonly IncomingFile[],
  ): Promise<StorageLocation[]>;
  /** The bytes, or `null` when they are not there any more. */
  get(file: StorageFileRef): Promise<Uint8Array | null>;
  /** `false` when the bytes are gone — metadata outliving its file. */
  exists(file: StorageFileRef): Promise<boolean>;
  /** Remove one file. Deleting something already gone is fine. */
  delete(file: StorageFileRef): Promise<void>;
  /** Remove everything a share ever stored (rollback, cleanup, expiry). */
  deleteShare(shareId: string): Promise<void>;
}
