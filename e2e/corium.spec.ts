import { expect, type Page, test } from '@playwright/test';

/**
 * The three critical Corium flows (V1 acceptance criteria):
 *
 *   1. Code:  create → link → open → content
 *   2. File:  upload → share → download
 *   3. PIN:   protected share → wrong PIN → correct PIN → content
 */

const RUN = Date.now().toString(36).slice(-6);
const unique = (prefix: string) => `${prefix}-${RUN}`;

/** Monaco renders its input surface as a hidden textarea inside `.monaco-editor`. */
async function typeIntoMonaco(page: Page, text: string) {
  const editor = page.locator('.monaco-editor');
  await editor.waitFor();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(text);
}

test.describe('flow 1 — code share round trip', () => {
  test('create a code share, open the link, see the content', async ({
    page,
  }) => {
    const route = unique('demo-code');
    const code = `console.log("hello from ${route}");`;

    await page.goto('/create/code');
    await typeIntoMonaco(page, code);
    await page.getByLabel('Route').fill(route);
    await page.getByRole('button', { name: 'Create share' }).click();

    // Lands on the share page showing the content.
    await expect(page).toHaveURL(new RegExp(`/${route}$`));
    await expect(page.locator('.monaco-editor')).toBeVisible();
    // The created content is rendered (Monaco splits text into DOM lines;
    // check the raw value through the editor model instead).
    const modelValue = await page.evaluate(() => {
      const monaco = (
        window as unknown as {
          monaco?: {
            editor: { getModels: () => { getValue: () => string }[] };
          };
        }
      ).monaco;
      return monaco?.editor.getModels()[0]?.getValue() ?? '';
    });
    expect(modelValue).toContain('hello from');
    // Copy button is present.
    await expect(
      page.getByRole('button', { name: /Copy link/i }),
    ).toBeVisible();
  });
});

test.describe('flow 2 — file share + download', () => {
  test('upload a file, share it, download it', async ({ page }) => {
    const route = unique('demo-file');

    // Prepare a fixture file.
    const path = await import('node:path');
    const os = await import('node:os');
    const fs = await import('node:fs/promises');
    const fixture = path.join(os.tmpdir(), `corium-e2e-${route}.txt`);
    await fs.writeFile(fixture, 'downloaded content from corium e2e');

    await page.goto('/create/file');
    const input = page.locator('input[type="file"]');
    await input.setInputFiles(fixture);
    await expect(page.getByText(/\.txt$/).first()).toBeVisible();

    await page.getByLabel('Route').fill(route);
    await page.getByRole('button', { name: 'Create share' }).click();

    await expect(page).toHaveURL(new RegExp(`/${route}$`));
    const downloadButton = page.getByRole('link', { name: /Download/i });
    await expect(downloadButton).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadButton.click(),
    ]);
    expect(download.suggestedFilename()).toContain('.txt');

    const downloadedPath = await download.path();
    const content = downloadedPath
      ? await fs.readFile(downloadedPath, 'utf8')
      : '';
    expect(content).toBe('downloaded content from corium e2e');
  });
});

test.describe('flow 3 — PIN-protected share', () => {
  test('wrong PIN is rejected, correct PIN unlocks the content', async ({
    page,
    browser,
  }) => {
    const route = unique('demo-pin');
    const pin = '7391';

    // Create a PIN-protected share (the creator gets an unlock cookie).
    await page.goto('/create/code');
    await typeIntoMonaco(page, 'secret payload for the e2e');
    await page.getByLabel('Route').fill(route);
    await page.getByLabel(/PIN/i).fill(pin);
    await page.getByRole('button', { name: 'Create share' }).click();
    await expect(page).toHaveURL(new RegExp(`/${route}$`));
    // Creator (who set the PIN) sees the content directly.
    await expect(page.locator('.monaco-editor')).toBeVisible();

    // A stranger (fresh context, no cookies) hits the PIN wall.
    const stranger = await browser.newContext();
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(`/${route}`);
    await expect(
      strangerPage.getByRole('heading', { name: 'PIN required' }),
    ).toBeVisible();

    // Wrong PIN → error.
    await strangerPage.locator('#pin').fill('0000');
    await strangerPage.getByRole('button', { name: 'Unlock' }).click();
    await expect(strangerPage.getByText(/Incorrect PIN/i)).toBeVisible();

    // Correct PIN → content appears.
    await strangerPage.locator('#pin').fill(pin);
    await strangerPage.getByRole('button', { name: 'Unlock' }).click();
    await expect(strangerPage.locator('.monaco-editor')).toBeVisible();

    await stranger.close();
  });
});
