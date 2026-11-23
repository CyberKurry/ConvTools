import { expect, test } from '@playwright/test';
import { launchExtensionContext, openExtensionPage } from './extension-context';

/**
 * Drag regressions for the quick-tab strip. The action popup is only 380px
 * wide (spec §9.1 shell), so these tests run in that viewport: dragging right
 * used to translate a tab past the strip edge, where the transformed overflow
 * combined with dnd-kit autoScroll scrolled the row away and swallowed the
 * gesture entirely.
 */
test.describe('popup quick-tab drag', () => {
  test('reorders when the first tab is dragged right past the sibling', async () => {
    const { context, extensionId } = await launchExtensionContext();
    try {
      const page = await openExtensionPage(context, extensionId, 'popup');
      await page.setViewportSize({ width: 380, height: 560 });
      const base64 = page.getByRole('tab', { name: 'Base64' });
      const timestamp = page.getByRole('tab', { name: 'Timestamp' });
      await expect(base64).toBeVisible();

      const source = await base64.boundingBox();
      const sibling = await timestamp.boundingBox();
      if (!source || !sibling) {
        throw new Error('tab bounding boxes unavailable');
      }
      const y = source.y + source.height / 2;
      await page.mouse.move(source.x + source.width / 2, y);
      await page.mouse.down();
      for (let x = source.x + source.width / 2; x <= sibling.x + sibling.width + 24; x += 6) {
        await page.mouse.move(x, y);
        await page.waitForTimeout(20);
      }
      await page.mouse.up();
      await page.waitForTimeout(300);

      const afterBase64 = await base64.boundingBox();
      const afterTimestamp = await timestamp.boundingBox();
      expect(afterBase64?.x).toBeGreaterThan(afterTimestamp?.x ?? 0);
      // Both tabs stay visible: the strip must not have been scrolled away.
      expect(afterTimestamp?.x).toBeGreaterThanOrEqual(0);
      const scrollLeft = await page.evaluate(() => {
        const list = document.querySelector('[role="tablist"]');
        return list instanceof HTMLElement ? list.scrollLeft : -1;
      });
      expect(scrollLeft).toBe(0);
    } finally {
      await context.close();
    }
  });

  test('reorders when the last tab is dragged left over the sibling', async () => {
    const { context, extensionId } = await launchExtensionContext();
    try {
      const page = await openExtensionPage(context, extensionId, 'popup');
      await page.setViewportSize({ width: 380, height: 560 });
      const base64 = page.getByRole('tab', { name: 'Base64' });
      const timestamp = page.getByRole('tab', { name: 'Timestamp' });
      await expect(timestamp).toBeVisible();

      const source = await timestamp.boundingBox();
      const sibling = await base64.boundingBox();
      if (!source || !sibling) {
        throw new Error('tab bounding boxes unavailable');
      }
      const y = source.y + source.height / 2;
      await page.mouse.move(source.x + source.width / 2, y);
      await page.mouse.down();
      for (let x = source.x + source.width / 2; x >= sibling.x - 24; x -= 6) {
        await page.mouse.move(x, y);
        await page.waitForTimeout(20);
      }
      await page.mouse.up();
      await page.waitForTimeout(300);

      const afterBase64 = await base64.boundingBox();
      const afterTimestamp = await timestamp.boundingBox();
      expect(afterTimestamp?.x).toBeLessThan(afterBase64?.x ?? Number.MAX_SAFE_INTEGER);
    } finally {
      await context.close();
    }
  });
});
