import { expect, test } from '@playwright/test';
import { launchExtensionContext, openExtensionPage } from './extension-context';

test.describe('workbench', () => {
  test('navigates to a module by hash', async () => {
    const { context, extensionId } = await launchExtensionContext();
    try {
      const page = await openExtensionPage(context, extensionId, 'workbench');
      await page.goto(`${page.url()}#timestamp`);
      // The sidebar link and the surface content both mention the module;
      // assert the selected-module heading to verify hash navigation.
      await expect(page.getByRole('heading', { name: 'Timestamp' })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});