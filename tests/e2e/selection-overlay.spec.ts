import { expect, test, type Page } from '@playwright/test';
import { launchExtensionContext, openExtensionPage } from './extension-context';

/**
 * Drives the production selection-action pipeline end-to-end: background
 * message → module conversion → session handoff → restricted-page fallback
 * tab (spec §9.3 "自动在工作台展示结果"). The target here is the extension's
 * own workbench page, which scripting.executeScript cannot enter — exactly
 * the production condition that selects the workbench fallback. The injected
 * overlay itself (user-gesture → activeTab injection) keeps component-level
 * coverage and the manual smoke checklist, because Playwright cannot produce
 * the native context-menu gesture that grants activeTab.
 */
async function triggerSelectionAction(page: Page): Promise<void> {
  await page.evaluate(() =>
    (
      globalThis as unknown as {
        browser: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
      }
    ).browser.runtime.sendMessage({
        kind: 'request',
        type: 'CONVTOOLS_TEST_SHOW_OVERLAY',
        id: 'e2e',
        payload: {
          moduleId: 'base64',
      actionId: 'decode',
      selectionText: 'SGVsbG8=',
    },
      }),
  );
}

test.describe('selection action fallback (end-to-end)', () => {
  test('hands an undeliverable conversion result to the workbench exactly once', async () => {
    test.setTimeout(60_000);
    const { context, extensionId } = await launchExtensionContext();
    try {
      const page = await openExtensionPage(context, extensionId, 'workbench');

      // Real flow: background runs the Base64 decode ("SGVsbG8=" → "Hello"),
      // stores a one-time handoff payload, and opens the fallback tab.
      const handoffPromise = context.waitForEvent('page', { timeout: 15_000 });
      await triggerSelectionAction(page);
      const handoffPage = await handoffPromise;
      await expect(handoffPage).toHaveURL(/workbench\.html#handoff=/);
      await expect(handoffPage.getByText('Hello', { exact: true })).toBeVisible();

      // The workbench replaces the URL after consuming, so refreshing cannot
      // re-consume the one-time payload.
      await expect(handoffPage).not.toHaveURL(/#handoff=/);
      await handoffPage.reload();
      await expect(handoffPage.getByText('Hello', { exact: true })).not.toBeVisible();
    } finally {
      await context.close();
    }
  });
});
