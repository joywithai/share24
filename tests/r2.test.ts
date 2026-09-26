import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';

import {
  createR2Client,
  getSignedUrl,
  type IncomingFile,
  R2StorageProvider,
  r2Endpoint,
  readR2Config,
  StorageConfigError,
  StorageError,
} from '@/lib/storage';

/**
 * R2 without a network: the SDK client is replaced by a recorder, so these
 * tests pin the *contract* — bucket, key names, error mapping, cleanup — that
 * the provider would send to Cloudflare.
 */

const ENV: Record<string, string | undefined> = {
  R2_ACCOUNT_ID: 'acc123',
  R2_ACCESS_KEY_ID: 'key123',
  R2_SECRET_ACCESS_KEY: 'secret123',
  R2_BUCKET_NAME: 'corium-files',
};

interface Sent {
  name: string;
  input: Record<string, unknown>;
}

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

function incoming(
  fileName: string,
  position: number,
  body: string,
  mimeType = 'text/plain',
): IncomingFile {
  return {
    fileName,
    position,
    mimeType,
    fileSize: Buffer.byteLength(body),
    bytes: async () => new Uint8Array(Buffer.from(body)),
  };
}

function providerWith(handler: (name: string, input: any) => unknown) {
  const { client, sent } = recorder(handler);
  return { provider: R2StorageProvider.fromEnv(ENV, client), sent };
}

/** A 404-shaped SDK error, the way S3/R2 reports a missing object. */
function notFound(): Error {
  const error = new Error('not found') as Error & {
    name: string;
    $metadata: { httpStatusCode: number };
  };
  error.name = 'NoSuchKey';
  error.$metadata = { httpStatusCode: 404 };
  return error;
}

describe('readR2Config', () => {
  it('accepts a complete environment', () => {
    const config = readR2Config(ENV);

    expect(config.bucket).toBe('corium-files');
    expect(config.endpoint).toBe('https://acc123.r2.cloudflarestorage.com');
  });

  it('names every missing variable instead of failing vaguely', () => {
    expect(() => readR2Config({})).toThrow(StorageConfigError);
    expect(() => readR2Config({})).toThrow(/R2_ACCOUNT_ID/);
    expect(() =>
      readR2Config({ R2_ACCOUNT_ID: 'a', R2_BUCKET_NAME: 'b' }),
    ).toThrow(/R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/);
    // Blank counts as missing.
    expect(() => readR2Config({ ...ENV, R2_BUCKET_NAME: '  ' })).toThrow(
      /R2_BUCKET_NAME/,
    );
  });

  it('builds the account endpoint', () => {
    expect(r2Endpoint('abc')).toBe('https://abc.r2.cloudflarestorage.com');
  });
});

describe('R2StorageProvider.save', () => {
  it('uploads every file under <shareId>/<nn>-<name>', async () => {
    const { provider, sent } = providerWith(() => ({}));

    const locations = await provider.save('share-1', [
      incoming('Report Final.pdf', 0, 'report'),
      incoming('two.txt', 1, 'second'),
    ]);

    expect(sent.map((entry) => entry.name)).toEqual([
      'PutObjectCommand',
      'PutObjectCommand',
    ]);
    expect(sent[0].input.Bucket).toBe('corium-files');
    expect(sent[0].input.Key).toBe('share-1/01-Report_Final.pdf');
    expect(sent[0].input.ContentType).toBe('text/plain');
    expect(sent[1].input.Key).toBe('share-1/02-two.txt');

    expect(locations).toEqual([
      {
        storedPath: 'share-1/01-Report_Final.pdf',
        storageType: 'R2',
        r2Key: 'share-1/01-Report_Final.pdf',
        r2Bucket: 'corium-files',
      },
      {
        storedPath: 'share-1/02-two.txt',
        storageType: 'R2',
        r2Key: 'share-1/02-two.txt',
        r2Bucket: 'corium-files',
      },
    ]);
  });

  it('removes what it already uploaded when a later file fails', async () => {
    let uploads = 0;
    const { provider, sent } = providerWith((name) => {
      if (name === 'PutObjectCommand') {
        uploads += 1;
        if (uploads === 2) throw new Error('network went away');
      }
      return {};
    });

    await expect(
      provider.save('share-2', [
        incoming('a.txt', 0, 'a'),
        incoming('b.txt', 1, 'b'),
      ]),
    ).rejects.toThrow(StorageError);

    const cleanup = sent.at(-1);
    expect(cleanup?.name).toBe('DeleteObjectsCommand');
    expect(cleanup?.input.Delete).toEqual({
      Objects: [{ Key: 'share-2/01-a.txt' }],
      Quiet: true,
    });
  });

  it('refuses a share id that could escape its folder', async () => {
    const { provider } = providerWith(() => ({}));
    await expect(
      provider.save('../etc', [incoming('a.txt', 0, 'x')]),
    ).rejects.toThrow(/unsafe/i);
  });
});

describe('R2StorageProvider reads', () => {
  it('returns the bytes of an object', async () => {
    const { provider, sent } = providerWith(() => ({
      Body: { transformToByteArray: async () => Buffer.from('from R2') },
    }));

    const data = await provider.get(row('share-1/01-a.txt'));

    expect(Buffer.from(data!).toString('utf8')).toBe('from R2');
    expect(sent[0].name).toBe('GetObjectCommand');
    expect(sent[0].input.Key).toBe('share-1/01-a.txt');
  });

  it('maps "not found" to null and false, not to an exception', async () => {
    const { provider } = providerWith((name) => {
      if (name === 'GetObjectCommand') throw notFound();
      throw notFound();
    });

    expect(await provider.get(row('share-1/gone.txt'))).toBeNull();
    expect(await provider.exists(row('share-1/gone.txt'))).toBe(false);
  });

  it('throws a typed error when the bucket answers with something else', async () => {
    const { provider } = providerWith(() => {
      throw new Error('AccessDenied');
    });

    await expect(provider.get(row('share-1/a.txt'))).rejects.toThrow(
      /R2 download failed/,
    );
    await expect(provider.exists(row('share-1/a.txt'))).rejects.toThrow(
      /R2 head failed/,
    );
  });

  it('trusts the bucket recorded on the row', async () => {
    const { provider, sent } = providerWith(() => ({
      Body: { transformToByteArray: async () => new Uint8Array([1]) },
    }));

    await provider.get({ ...row('share-1/a.txt'), r2Bucket: 'older-bucket' });

    expect(sent[0].input.Bucket).toBe('older-bucket');
  });

  it('refuses a key that tries to leave the bucket prefix', async () => {
    const { provider } = providerWith(() => ({}));
    await expect(provider.get(row('../other/secret'))).rejects.toThrow(
      /unsafe object key/i,
    );
  });
});

describe('R2StorageProvider.delete', () => {
  it('deletes one object by key', async () => {
    const { provider, sent } = providerWith(() => ({}));

    await provider.delete(row('share-1/01-a.txt'));

    expect(sent[0].name).toBe('DeleteObjectCommand');
    expect(sent[0].input.Key).toBe('share-1/01-a.txt');
  });

  it('deletes a whole share, following the listing pages', async () => {
    let listings = 0;
    const { provider, sent } = providerWith((name) => {
      if (name === 'ListObjectsV2Command') {
        listings += 1;
        return listings === 1
          ? {
              Contents: [
                { Key: 'share-3/01-a.txt' },
                { Key: 'share-3/02-b.txt' },
              ],
              IsTruncated: true,
              NextContinuationToken: 'page-2',
            }
          : { Contents: [{ Key: 'share-3/03-c.txt' }], IsTruncated: false };
      }
      return {};
    });

    await provider.deleteShare('share-3');

    const prefixes = sent
      .filter((entry) => entry.name === 'ListObjectsV2Command')
      .map((entry) => entry.input.Prefix);
    expect(prefixes).toEqual(['share-3/', 'share-3/']);

    const deletes = sent.filter(
      (entry) => entry.name === 'DeleteObjectsCommand',
    );
    expect(deletes).toHaveLength(1);
    expect(deletes[0].input.Delete).toEqual({
      Objects: [
        { Key: 'share-3/01-a.txt' },
        { Key: 'share-3/02-b.txt' },
        { Key: 'share-3/03-c.txt' },
      ],
      Quiet: true,
    });
  });

  it('does nothing for a share that stored nothing', async () => {
    const { provider, sent } = providerWith(() => ({
      Contents: [],
      IsTruncated: false,
    }));

    await expect(provider.deleteShare('share-4')).resolves.toBeUndefined();
    expect(sent.map((entry) => entry.name)).toEqual(['ListObjectsV2Command']);
  });
});

describe('getSignedUrl', () => {
  it('signs a temporary GET URL for the object (offline)', async () => {
    const client = createR2Client(readR2Config(ENV));

    const url = await getSignedUrl(
      client,
      ENV.R2_BUCKET_NAME as string,
      'share-1/01-a.txt',
    );

    // The SDK builds a virtual-hosted URL for the bucket on the account
    // endpoint; R2 serves both styles, so the host and the signature matter.
    expect(url).toContain('.acc123.r2.cloudflarestorage.com/');
    expect(url).toContain('corium-files');
    expect(url).toContain('/share-1/01-a.txt');
    expect(url).toContain('X-Amz-Signature');
    expect(url).toContain('X-Amz-Expires');
  });

  it('refuses to sign a key it would not fetch either', async () => {
    const client = createR2Client(readR2Config(ENV));
    await expect(
      getSignedUrl(client, 'corium-files', '/absolute/key'),
    ).rejects.toThrow(/unsafe object key/i);
  });
});

/** A row as it comes out of the database. */
function row(key: string) {
  return {
    storedPath: key,
    storageType: 'R2' as const,
    r2Key: key,
    r2Bucket: null,
  };
}
