import { expect, test } from '@playwright/test';
import { launchExtensionContext, openExtensionPage } from './extension-context';

test.describe('popup', () => {
  test('shows Base64 and timestamp quick modules in first-install order', async () => {
    const { context, extensionId } = await launchExtensionContext();
    try {
      const page = await openExtensionPage(context, extensionId, 'popup');
      await expect(page.getByRole('tab', { name: 'Base64' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Timestamp' })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('renders the selected module surface', async () => {
    const { context, extensionId } = await launchExtensionContext();
    try {
      const page = await openExtensionPage(context, extensionId, 'popup');
      await expect(page.getByRole('textbox', { name: 'Input' })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('switches the rendered surface when a quick module tab is clicked', async () => {
    const { context, extensionId } = await launchExtensionContext();
    try {
      const page = await openExtensionPage(context, extensionId, 'popup');
      await expect(page.getByRole('textbox', { name: 'Input' })).toBeVisible();

      await page.getByRole('tab', { name: 'Timestamp' }).click();

      await expect(page.getByRole('textbox', { name: 'Timestamp' })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Input' })).not.toBeVisible();
    } finally {
      await context.close();
    }
  });
});
