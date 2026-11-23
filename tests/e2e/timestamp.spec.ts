import { expect, test } from '@playwright/test';
import { launchExtensionContext, openExtensionPage } from './extension-context';

test.describe('timestamp (end-to-end)', () => {
  test('converts a timestamp using the real Temporal-backed surface', async () => {
    const { context, extensionId } = await launchExtensionContext();
    try {
      const page = await openExtensionPage(context, extensionId, 'workbench');
      await page.goto(`${page.url()}#timestamp`);
      await expect(page.getByRole('heading', { name: 'Timestamp' })).toBeVisible();
      await page.getByLabel('Timestamp').fill('0');
      await page.getByLabel('Unit').selectOption('seconds');
      await page.getByRole('button', { name: 'Convert to date' }).click();
      await expect(page.getByText('1970-01-01T00:00:00Z')).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
