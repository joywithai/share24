import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Point file storage at a throwaway directory BEFORE any module reads it.
process.env.CORIUM_UPLOADS_DIR ??= mkdtempSync(
  path.join(tmpdir(), 'corium-test-'),
);

// Deterministic HMAC secret for unlock-token tests.
process.env.UNLOCK_SECRET = 'test-unlock-secret';
