import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  B2StorageProvider,
  providerFor,
  resetStorageProviders,
} from '@/lib/storage';

/**
 * The B2 provider over a real socket.
 *
 * Everything above the wire is production code: the AWS SDK signs and sends a
 * genuine HTTP request, the provider builds the key and maps the response. Only
 * the far end is a stub — a few hundred lines of S3 would not fit in a unit
 * test, so this server implements exactly the four operations the provider
 * uses, and asserts on what it received.
 *
 * It also proves the endpoint handling that matters for anyone running an
 * S3-compatible service (MinIO, a NAS, a VPS): an `http://` endpoint with
 * path-style addressing, which is what `readB2Config` enables for localhost.
 */

interface Stored {
  body: Buffer;
  contentType?: string;
}

const bucket = new Map<string, Stored>();
const requests: { method: string; path: string }[] = [];
let server: Server;
let endpoint = '';

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk as Buffer));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    // Path style: /sharede/<key>
    const [, bucketName, ...rest] = url.pathname.split('/');
    const key = rest.join('/');
    requests.push({ method: request.method ?? '', path: url.pathname });

    if (bucketName !== 'sharede') {
      response.writeHead(404).end('no such bucket');
      return;
    }

    if (request.method === 'PUT') {
      const body = await readBody(request);
      bucket.set(key, {
        body,
        contentType: request.headers['content-type'] as string | undefined,
      });
      response.writeHead(200).end();
      return;
    }

    if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const contents = [...bucket.keys()]
        .filter((name) => name.startsWith(prefix))
        .map((name) => `<Contents><Key>${name}</Key></Contents>`)
        .join('');
      response.writeHead(200, { 'Content-Type': 'application/xml' });
      response.end(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
      );
      return;
    }

    if (request.method === 'POST' && url.searchParams.has('delete')) {
      const body = (await readBody(request)).toString('utf8');
      const keys = [...body.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
      for (const name of keys) bucket.delete(name);
      response.writeHead(200, { 'Content-Type': 'application/xml' });
      response.end('<?xml version="1.0"?><DeleteResult/>');
      return;
    }

    if (request.method === 'GET') {
      const stored = bucket.get(key);
      if (!stored) {
        response.writeHead(404, { 'Content-Type': 'application/xml' });
        response.end(
          '<?xml version="1.0"?><Error><Code>NoSuchKey</Code></Error>',
        );
        return;
      }
      response.writeHead(200, {
        'Content-Type': stored.contentType ?? 'application/octet-stream',
        'Content-Length': String(stored.body.length),
      });
      response.end(stored.body);
      return;
    }

    if (request.method === 'HEAD') {
      const stored = bucket.get(key);
      if (!stored) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Length': String(stored.body.length),
      });
      response.end();
      return;
    }

    if (request.method === 'DELETE') {
      bucket.delete(key);
      response.writeHead(204).end();
      return;
    }

    response.writeHead(400).end('unsupported');
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address && typeof address === 'object') {
    endpoint = `http://127.0.0.1:${address.port}`;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function providerForTest(): B2StorageProvider {
  return B2StorageProvider.fromEnv({
    B2_ENDPOINT: endpoint,
    B2_BUCKET_NAME: 'sharede',
    B2_KEY_ID: 'test-key-id',
    B2_APPLICATION_KEY: 'test-application-key',
    B2_REGION: 'us-east-005',
  });
}

describe('B2 storage over HTTP', () => {
  it('uploads, finds, downloads and deletes a real object', async () => {
    const provider = providerForTest();
    const shareId = 'b2live-0001';

    const [location] = await provider.save(shareId, [
      {
        // Non-ASCII names are sanitised to underscores before they reach the
        // bucket — `নোট` is three characters, so it becomes three of them.
        fileName: 'নোট.txt',
        position: 0,
        mimeType: 'text/plain',
        fileSize: 0,
        bytes: async () => new TextEncoder().encode('hello from B2'),
      },
    ]);

    expect(location.storedPath).toBe(`${shareId}/01-___.txt`);
    expect(location.r2Bucket).toBe('sharede');
    expect(provider.type).toBe('B2');

    const row = {
      storedPath: location.storedPath,
      storageType: 'B2' as const,
      r2Key: location.r2Key,
      r2Bucket: location.r2Bucket,
    };

    expect(await provider.exists(row)).toBe(true);
    const bytes = await provider.get(row);
    expect(new TextDecoder().decode(bytes!)).toBe('hello from B2');

    await provider.delete(row);
    expect(await provider.exists(row)).toBe(false);
    expect(await provider.get(row)).toBeNull();
  });

  it('serves a set and clears it again with deleteShare', async () => {
    const provider = providerForTest();
    const shareId = 'b2live-0002';
    const files = ['one.txt', 'two.txt', 'three.txt'].map(
      (fileName, index) => ({
        fileName,
        position: index,
        mimeType: 'text/plain',
        fileSize: 0,
        bytes: async () => new TextEncoder().encode(`${fileName} body`),
      }),
    );

    const locations = await provider.save(shareId, files);
    expect(locations).toHaveLength(3);

    const keys = locations.map((location) => location.storedPath);
    expect(keys).toEqual([
      `${shareId}/01-one.txt`,
      `${shareId}/02-two.txt`,
      `${shareId}/03-three.txt`,
    ]);
    expect(
      [...bucket.keys()].filter((key) => key.startsWith(shareId)),
    ).toHaveLength(3);

    await provider.deleteShare(shareId);
    expect([...bucket.keys()].filter((key) => key.startsWith(shareId))).toEqual(
      [],
    );
    // The other share's objects are untouched.
    // The first test's object is gone too — deleteShare only touched its own
    // prefix, and that share had already been deleted file by file.
    expect(
      [...bucket.keys()].filter((key) => key.startsWith('b2live-0001')),
    ).toEqual([]);
  });

  it('sends the bytes with the content type and a path-style URL', async () => {
    requests.length = 0;
    const provider = providerForTest();
    await provider.save('b2live-0003', [
      {
        fileName: 'report.pdf',
        position: 0,
        mimeType: 'application/pdf',
        fileSize: 0,
        bytes: async () => new Uint8Array([37, 80, 68, 70]),
      },
    ]);

    expect(requests[0].method).toBe('PUT');
    expect(requests[0].path).toBe('/sharede/b2live-0003/01-report.pdf');
    expect(bucket.get('b2live-0003/01-report.pdf')?.contentType).toBe(
      'application/pdf',
    );
  });

  it('reports a missing object as gone rather than throwing', async () => {
    const provider = providerForTest();
    const row = {
      storedPath: 'b2live-0009/never-uploaded.txt',
      storageType: 'B2' as const,
      r2Key: 'b2live-0009/never-uploaded.txt',
      r2Bucket: 'sharede',
    };
    expect(await provider.exists(row)).toBe(false);
    expect(await provider.get(row)).toBeNull();
  });

  it('is what the storage index returns for STORAGE_TYPE=B2', () => {
    resetStorageProviders();
    const previous = {
      STORAGE_TYPE: process.env.STORAGE_TYPE,
      B2_ENDPOINT: process.env.B2_ENDPOINT,
      B2_BUCKET_NAME: process.env.B2_BUCKET_NAME,
      B2_KEY_ID: process.env.B2_KEY_ID,
      B2_APPLICATION_KEY: process.env.B2_APPLICATION_KEY,
      B2_REGION: process.env.B2_REGION,
    };
    process.env.STORAGE_TYPE = 'B2';
    process.env.B2_ENDPOINT = endpoint;
    process.env.B2_BUCKET_NAME = 'sharede';
    process.env.B2_KEY_ID = 'test-key-id';
    process.env.B2_APPLICATION_KEY = 'test-application-key';
    process.env.B2_REGION = 'us-east-005';

    try {
      expect(
        providerFor({
          storedPath: 'b2live-0001/01-_.txt',
          storageType: 'B2',
          r2Key: 'b2live-0001/01-_.txt',
          r2Bucket: 'sharede',
        }).type,
      ).toBe('B2');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetStorageProviders();
    }
  });
});
