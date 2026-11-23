import { expect, test } from '@playwright/test';
import { launchExtensionContext, openExtensionPage } from './extension-context';

test.describe('options', () => {
  test('shows the settings page with module controls', async () => {
    const { context, extensionId } = await launchExtensionContext();
    try {
      const page = await openExtensionPage(context, extensionId, 'options');
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      // Scoped to the module-management list: the quick-order list repeats
      // the module names now that it shows them without a position prefix.
      const modules = page.getByRole('list').filter({ has: page.getByRole('button', { name: /Disable and delete data/ }) });
      await expect(modules.getByText('Base64', { exact: true })).toBeVisible();
      await expect(modules.getByText('Timestamp', { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});