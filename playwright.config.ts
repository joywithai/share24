import { defineConfig } from '@playwright/test';

/**
 * E2E configuration.
 *
 *   npx playwright install chromium   (one-time browser download)
 *   npm run e2e                       (reuses a running server if present)
 *
 * The web server must be reachable at `baseURL` — either the dev server
 * (`npm run dev`) or a built one (`npm run build && npm start`), plus the
 * database (`npm run db:dev`).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
    // Browser tests always run against the disk and the in-memory limiter:
    // no bucket credentials to leak into a test run, no Redis to depend on.
    // (`reuseExistingServer` means an already-running dev server keeps its own
    // environment — stop it first if you want these to apply.)
    env: {
      STORAGE_TYPE: 'LOCAL',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
    },
  },
});
