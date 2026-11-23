import { expect, test } from '@playwright/test';
import { extensionUrl, launchExtensionContext } from './extension-context';

const INCOGNITO_OVERRIDE = 'CONVTOOLS_TEST_INCOGNITO_OVERRIDE=1';

test.describe('incognito persistence boundary (end-to-end)', () => {
  test('keeps a settings change in memory and out of browser storage', async () => {
    const { context, extensionId } = await launchExtensionContext();
    try {
      const page = await context.newPage();
      await page.goto(`${extensionUrl(extensionId, 'options')}?${INCOGNITO_OVERRIDE}`);
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await page.getByLabel('Theme').selectOption('dark');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      const stored = await page.evaluate(() =>
        (globalThis as unknown as {
          browser: { storage: { sync: { get(keys: string[]): Promise<Record<string, unknown>> } } };
        }).browser.storage.sync.get(['theme']),
      );
      expect(stored.theme).toBeUndefined();
    } finally {
      await context.close();
    }
  });
});
