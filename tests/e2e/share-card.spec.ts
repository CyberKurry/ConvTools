import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import { launchExtensionContext, openExtensionPage } from './extension-context';

/**
 * Drives the share-card pipeline end-to-end over the real background flow:
 * CONVTOOLS_TEST_SHOW_OVERLAY → generate action → workbench-input hand-off →
 * editor prefill → worker render → export → file-metadata history. As with
 * selection-overlay.spec.ts, Playwright cannot produce the native
 * context-menu gesture, so the trigger arrives through the test-only message
 * hook; everything after it is production code.
 */
async function triggerGenerate(page: Page, selectionText: string): Promise<void> {
  await page.evaluate((text) => {
    const extension = (globalThis as { browser?: { runtime: { sendMessage(message: unknown): Promise<unknown> } } }).browser;
    return extension?.runtime.sendMessage({
        kind: 'request',
        type: 'CONVTOOLS_TEST_SHOW_OVERLAY',
        id: 'e2e',
        payload: {
          moduleId: 'share-card',
      actionId: 'generate',
      selectionText: text,
    },
      });
  }, selectionText);
}

async function openShareCardEditor(context: BrowserContext, sourcePage: Page): Promise<Page> {
  await context.addInitScript(() => {
    const container = window as unknown as { __errors?: string[] };
    container.__errors = [];
    window.addEventListener('error', (event) => {
      container.__errors!.push(`error: ${String(event.error ?? event.message)}`);
    });
    window.addEventListener('unhandledrejection', (event) => {
      container.__errors!.push(`rejection: ${String(event.reason)}`);
    });
  });
  const handoffPromise = context.waitForEvent('page', { timeout: 15_000 });
  await triggerGenerate(sourcePage, 'quoted words');
  const editorPage = await handoffPromise;
  // The one-time input payload is consumed within the first paint, so the
  // hash may already be gone; the editor state is the observable contract.
  await expect(editorPage).toHaveURL(/workbench\.html/);
  await expect(editorPage.getByLabel('Excerpt')).toHaveValue('quoted words', { timeout: 15_000 });
  await expect(editorPage).not.toHaveURL(/#handoff=/);
  return editorPage;
}

async function waitForRenderedPreview(editor: Page): Promise<void> {
  const canvas = editor.getByRole('img', { name: /Card preview/ });
  await expect(canvas).toBeVisible();
  await expect
    .poll(
      async () =>
        canvas.evaluate((element) => {
          const preview = element as HTMLCanvasElement;
          if (preview.width === 0 || preview.height === 0) {
            return false;
          }
          const ctx = preview.getContext('2d');
          if (!ctx) {
            return false;
          }
          const { data } = ctx.getImageData(0, 0, preview.width, preview.height);
          return data.some((value) => value !== 0);
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
}

test.describe('share card (end-to-end)', () => {
  test('prefills the workbench editor from a selection and renders a preview', async () => {
    test.setTimeout(60_000);
    const { context, extensionId } = await launchExtensionContext();
    try {
      const page = await openExtensionPage(context, extensionId, 'workbench');
      const editor = await openShareCardEditor(context, page);

      // Page metadata was absent (extension page), so the URL stays empty;
      // the approved empty-URL degradation is silent and simply omits the QR.
      await expect(editor.getByText('No link — the card is generated without a QR code.')).not.toBeVisible();

      // The live preview canvas exists, is accessible, and the worker has
      // painted real pixels into it (portrait aspect at preview scale).
      await waitForRenderedPreview(editor);

      // Editing the excerpt re-renders the preview through the worker.
      await editor.getByLabel('Excerpt').fill('edited quote');
      await expect(editor.getByLabel('Excerpt')).toHaveValue('edited quote');
    } finally {
      await context.close();
    }
  });

  test('downloads a 2x png with the generated file name', async () => {
    test.setTimeout(60_000);
    const { context, extensionId } = await launchExtensionContext();
    try {
      const page = await openExtensionPage(context, extensionId, 'workbench');
      const editor = await openShareCardEditor(context, page);
      await waitForRenderedPreview(editor);

      const downloadPromise = editor.waitForEvent('download', { timeout: 20_000 });
      await editor.getByRole('button', { name: 'Download PNG' }).click();
      const download = await downloadPromise;

      expect(download.suggestedFilename()).toBe('share-card-paper-2160x2880.png');
      const path = await download.path();
      const bytes = fs.readFileSync(path);
      // PNG signature (8 bytes) followed by the IHDR chunk type.
      expect(bytes.subarray(0, 4).toString('binary')).toBe('\u0089PNG');
      expect(bytes.subarray(12, 16).toString('binary')).toBe('IHDR');
    } finally {
      await context.close();
    }
  });

  test('records the export in module history with the encoded url', async () => {
    test.setTimeout(60_000);
    const { context, extensionId } = await launchExtensionContext();
    try {
      const page = await openExtensionPage(context, extensionId, 'workbench');
      // History is opt-in (spec §14): flip the toggle, then reload so the
      // kernel starts with it enabled.
      await page.evaluate(() =>
        (
          globalThis as unknown as {
            browser: { storage: { local: { set(items: Record<string, unknown>): Promise<void> } } };
          }
        ).browser.storage.local.set({ historyEnabled: true }),
      );
      await page.reload();

      const editor = await openShareCardEditor(context, page);
      // Fill a valid link so the history record carries the source url.
      await editor.getByLabel('Link').fill('https://example.com/article?utm=x');
      const downloadPromise = editor.waitForEvent('download');
      await editor.getByRole('button', { name: 'Download PNG' }).click();
      await downloadPromise;

      // The history append is fire-and-forget (spec §15: history must never
      // block an export), so wait for the record to land in IndexedDB before
      // reloading - otherwise a fast reload can outrun the write.
      await expect
        .poll(
          () =>
            editor.evaluate(async () => {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open('convtools-history');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error ?? new Error('history db open failed'));
              });
              try {
                const records = await new Promise<Array<{ name?: string; sourceUrl?: string }>>((resolve, reject) => {
                  const tx = db.transaction('records', 'readonly');
                  const all = tx.objectStore('records').getAll();
                  all.onsuccess = () => resolve(all.result as Array<{ name?: string; sourceUrl?: string }>);
                  all.onerror = () => reject(all.error ?? new Error('history read failed'));
                });
                return records.some((record) => record.name === 'share-card-paper-2160x2880.png');
              } finally {
                db.close();
              }
            }),
          { timeout: 15_000 },
        )
        .toBe(true);

      // The history panel mounts per module view; reload to re-read records.
      await editor.reload();
      await editor.getByRole('link', { name: 'Share Card' }).click();
      await expect(editor.getByText('share-card-paper-2160x2880.png')).toBeVisible();
      await expect(editor.getByText(/example\.com\/article/)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('appears in the workbench sidebar but not the popup quick bar', async () => {
    test.setTimeout(60_000);
    const { context, extensionId } = await launchExtensionContext();
    try {
      const popup = await openExtensionPage(context, extensionId, 'popup');
      await expect(popup.getByRole('tab', { name: 'Base64' })).toBeVisible();
      await expect(popup.getByRole('tab', { name: 'Share Card' })).toHaveCount(0);

      const workbench = await openExtensionPage(context, extensionId, 'workbench');
      await expect(workbench.getByRole('link', { name: 'Share Card' })).toBeVisible();
      await workbench.getByRole('link', { name: 'Share Card' }).click();
      await expect(workbench.getByLabel('Excerpt')).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
