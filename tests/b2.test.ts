import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';

import {
  B2StorageProvider,
  b2Endpoint,
  configuredStorageType,
  createB2Client,
  getStorageProvider,
  isB2Key,
  readB2Config,
  resetStorageProviders,
  StorageConfigError,
  StorageError,
} from '@/lib/storage';

/**
 * Backblaze B2 without a network: the SDK client is replaced by a recorder, so
 * these tests pin the *contract* — endpoint, region, bucket, key names, error
 * labels, rollback — that the provider would send to Backblaze. The real HTTP
 * path is exercised in `tests/b2-live.test.ts` against a local S3 server.
 */

const ENV: Record<string, string | undefined> = {
  B2_ENDPOINT: 's3.us-east-005.backblazeb2.com',
  B2_KEY_ID: '0042ab0000000000000000001',
  B2_APPLICATION_KEY: 'K004exampleApplicationKey0000000',
  B2_BUCKET_NAME: 'sharede',
  B2_REGION: 'us-east-005',
};

interface Sent {
  name: string;
  input: Record<string, unknown>;
}

/** A stand-in S3 client that records commands instead of sending them. */
function recorder(handler: (name: string, input: any) => unknown) {
  const sent: Sent[] = [];
  const client = {
    send: async (command: { constructor: { name: string }; input: any }) => {
      const name = command.constructor.name;
      sent.push({ name, input: command.input });
      return handler(name, command.input);
    },
  } as unknown as S3Client;
  return { client, sent };
}

const row = (storedPath: string, overrides: Record<string, unknown> = {}) => ({
  storedPath,
  storageType: 'B2' as const,
  r2Key: storedPath,
  r2Bucket: 'sharede',
  ...overrides,
});

describe('B2 configuration', () => {
  it('reads the five variables and defaults the region', () => {
    const config = readB2Config(ENV);
    expect(config.endpoint).toBe('https://s3.us-east-005.backblazeb2.com');
    expect(config.bucket).toBe('sharede');
    expect(config.keyId).toBe('0042ab0000000000000000001');
    expect(config.region).toBe('us-east-005');
    expect(config.forcePathStyle).toBe(false);

    const withoutRegion = readB2Config({ ...ENV, B2_REGION: undefined });
    expect(withoutRegion.region).toBe('us-east-005');
  });

  it('accepts an endpoint with a scheme, and keeps a bare host https', () => {
    expect(b2Endpoint('s3.us-east-005.backblazeb2.com')).toBe(
      'https://s3.us-east-005.backblazeb2.com',
    );
    expect(b2Endpoint('https://s3.us-east-005.backblazeb2.com/')).toBe(
      'https://s3.us-east-005.backblazeb2.com',
    );
    expect(b2Endpoint('http://127.0.0.1:9000')).toBe('http://127.0.0.1:9000');
  });

  it('switches to path-style addressing for a local endpoint', () => {
    const config = readB2Config({
      ...ENV,
      B2_ENDPOINT: 'http://127.0.0.1:9000',
    });
    expect(config.forcePathStyle).toBe(true);

    const explicit = readB2Config({ ...ENV, B2_FORCE_PATH_STYLE: 'true' });
    expect(explicit.forcePathStyle).toBe(true);
  });

  it('names every missing variable at once', () => {
    expect(() => readB2Config({})).toThrow(StorageConfigError);
    expect(() => readB2Config({})).toThrow(/B2_ENDPOINT/);
    expect(() => readB2Config({ B2_ENDPOINT: 'x' })).toThrow(
      /B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME/,
    );
    expect(() => readB2Config({ ...ENV, B2_BUCKET_NAME: '  ' })).toThrow(
      /B2_BUCKET_NAME/,
    );
  });

  it('builds a client for the bucket’s region', async () => {
    const client = createB2Client(readB2Config(ENV));
    // The region is resolved lazily by the SDK, so ask it for one.
    const region = await client.config.region();
    expect(region).toBe('us-east-005');
    expect(await client.config.endpoint!()).toMatchObject({
      hostname: 's3.us-east-005.backblazeb2.com',
      protocol: 'https:',
    });
  });

  it('selects B2 only when asked, and validates the value', () => {
    expect(configuredStorageType({ STORAGE_TYPE: 'B2' })).toBe('B2');
    expect(configuredStorageType({ STORAGE_TYPE: 'b2' })).toBe('B2');
    expect(configuredStorageType({ STORAGE_TYPE: 'LOCAL' })).toBe('LOCAL');
    expect(configuredStorageType({})).toBe('LOCAL');
    expect(() => configuredStorageType({ STORAGE_TYPE: 'S3' })).toThrow(
      /LOCAL", "R2" or "B2"/,
    );
  });
});

describe('B2StorageProvider', () => {
  it('uploads every file of a set under the share prefix', async () => {
    const { client, sent } = recorder(() => ({}));
    const provider = B2StorageProvider.fromEnv(ENV, client);

    const locations = await provider.save('share-1', [
      {
        fileName: 'Report Final.pdf',
        position: 0,
        mimeType: 'application/pdf',
        fileSize: 3,
        bytes: async () => new Uint8Array([1, 2, 3]),
      },
      {
        fileName: 'two.txt',
        position: 1,
        mimeType: 'text/plain',
        fileSize: 2,
        bytes: async () => new Uint8Array([4, 5]),
      },
    ]);

    expect(sent.map((entry) => entry.name)).toEqual([
      'PutObjectCommand',
      'PutObjectCommand',
    ]);
    expect(sent[0].input.Bucket).toBe('sharede');
    expect(sent[0].input.Key).toBe('share-1/01-Report_Final.pdf');
    expect(sent[0].input.ContentType).toBe('application/pdf');
    expect(sent[1].input.Key).toBe('share-1/02-two.txt');
    expect(locations).toEqual([
      {
        storedPath: 'share-1/01-Report_Final.pdf',
        storageType: 'B2',
        r2Key: 'share-1/01-Report_Final.pdf',
        r2Bucket: 'sharede',
      },
      {
        storedPath: 'share-1/02-two.txt',
        storageType: 'B2',
        r2Key: 'share-1/02-two.txt',
        r2Bucket: 'sharede',
      },
    ]);
  });

  it('removes what it already uploaded when a later file fails', async () => {
    let uploads = 0;
    const { client, sent } = recorder((name) => {
      if (name === 'PutObjectCommand') {
        uploads += 1;
        if (uploads === 2) throw new Error('B2 said no');
      }
      return {};
    });
    const provider = B2StorageProvider.fromEnv(ENV, client);

    await expect(
      provider.save('share-2', [
        {
          fileName: 'a.txt',
          position: 0,
          mimeType: 'text/plain',
          fileSize: 1,
          bytes: async () => new Uint8Array([1]),
        },
        {
          fileName: 'b.txt',
          position: 1,
          mimeType: 'text/plain',
          fileSize: 1,
          bytes: async () => new Uint8Array([2]),
        },
      ]),
    ).rejects.toThrow(StorageError);

    const cleanup = sent.at(-1);
    expect(cleanup?.name).toBe('DeleteObjectsCommand');
    expect(cleanup?.input.Bucket).toBe('sharede');
  });

  it('reads, checks and deletes the object named by the row', async () => {
    const { client, sent } = recorder((name) => {
      if (name === 'GetObjectCommand') {
        return {
          Body: {
            transformToByteArray: async () =>
              new Uint8Array([...'from B2'].map((c) => c.charCodeAt(0))),
          },
        };
      }
      return {};
    });
    const provider = B2StorageProvider.fromEnv(ENV, client);

    const data = await provider.get(row('share-1/01-a.txt'));
    expect(Buffer.from(data!).toString('utf8')).toBe('from B2');
    expect(sent[0].input.Key).toBe('share-1/01-a.txt');

    await provider.delete(row('share-1/01-a.txt'));
    expect(sent[1].name).toBe('DeleteObjectCommand');
    expect(sent[1].input.Key).toBe('share-1/01-a.txt');
  });

  it('answers "gone" for a 404 and "broken" for anything else', async () => {
    const missing = recorder(() => {
      throw Object.assign(new Error('nope'), { name: 'NoSuchKey' });
    });
    const provider = B2StorageProvider.fromEnv(ENV, missing.client);
    expect(await provider.get(row('share-1/gone.txt'))).toBeNull();
    expect(await provider.exists(row('share-1/gone.txt'))).toBe(false);

    const broken = recorder(() => {
      throw Object.assign(new Error('denied'), { name: 'AccessDenied' });
    });
    const brokenProvider = B2StorageProvider.fromEnv(ENV, broken.client);
    await expect(brokenProvider.get(row('share-1/a.txt'))).rejects.toThrow(
      /B2 download failed/,
    );
    await expect(brokenProvider.exists(row('share-1/a.txt'))).rejects.toThrow(
      /B2 head failed/,
    );
  });

  it('refuses a key that could escape the shared prefix', async () => {
    const { client } = recorder(() => ({}));
    const provider = B2StorageProvider.fromEnv(ENV, client);
    await expect(provider.get(row('../other/secret'))).rejects.toThrow(
      /unsafe object key/i,
    );
    await expect(provider.deleteShare('../..')).rejects.toThrow(
      /unsafe share id/i,
    );
  });

  it('deletes a whole share by listing its prefix first', async () => {
    const { client, sent } = recorder((name) => {
      if (name === 'ListObjectsV2Command') {
        return {
          Contents: [{ Key: 'share-4/01-a.txt' }, { Key: 'share-4/02-b.txt' }],
          IsTruncated: false,
        };
      }
      return {};
    });
    const provider = B2StorageProvider.fromEnv(ENV, client);

    await provider.deleteShare('share-4');
    expect(sent[0].name).toBe('ListObjectsV2Command');
    expect(sent[0].input.Prefix).toBe('share-4/');
    const del = sent.at(-1);
    expect(del?.name).toBe('DeleteObjectsCommand');
    expect((del?.input.Delete as { Objects: unknown[] }).Objects).toHaveLength(
      2,
    );
  });

  it('honours a row whose bucket differs from the configured one', async () => {
    const { client, sent } = recorder(() => ({}));
    const provider = B2StorageProvider.fromEnv(ENV, client);
    await provider.delete(
      row('share-1/01-a.txt', { r2Bucket: 'older-bucket' }),
    );
    expect(sent[0].input.Bucket).toBe('older-bucket');
  });

  it('is the provider the index hands out for a B2 row', () => {
    resetStorageProviders();
    const previous = { ...process.env };
    Object.assign(process.env, ENV, { STORAGE_TYPE: 'B2' });
    try {
      const provider = getStorageProvider('B2');
      expect(provider.type).toBe('B2');
      expect(getStorageProvider('B2')).toBe(provider); // memoised
    } finally {
      for (const key of Object.keys(ENV)) process.env[key] = previous[key];
      process.env.STORAGE_TYPE = previous.STORAGE_TYPE;
      resetStorageProviders();
    }
  });

  it('recognises the object keys it writes', () => {
    expect(isB2Key('share-1/01-a.txt')).toBe(true);
    expect(isB2Key('../etc/passwd')).toBe(false);
  });
});
