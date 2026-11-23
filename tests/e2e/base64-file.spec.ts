import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchExtensionContext, openExtensionPage } from './extension-context';

test.describe('Base64 file worker (end-to-end)', () => {
  test('encodes a real uploaded file in the page worker and downloads text', async () => {
    test.setTimeout(60_000);
    const { context, extensionId } = await launchExtensionContext();
    try {
      const page = await openExtensionPage(context, extensionId, 'workbench');
      const input = page.getByLabel('Choose file');
      await input.setInputFiles({
        name: 'sample.bin',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('hello', 'utf8'),
      });
      await expect(page.getByLabel('Output').last()).toHaveValue('aGVsbG8=', { timeout: 15_000 });
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download' }).last().click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('download.txt');
    } finally {
      await context.close();
    }
  });

  test('rejects a file above 50 MB before handing it to the worker', async () => {
    test.setTimeout(60_000);
    const { context, extensionId } = await launchExtensionContext();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convtools-e2e-large-'));
    const filePath = path.join(tempDir, 'too-large.bin');
    try {
      const page = await openExtensionPage(context, extensionId, 'workbench');
      fs.writeFileSync(filePath, Buffer.alloc(50 * 1024 * 1024 + 1));
      await page.getByLabel('Choose file').setInputFiles(filePath);
      await expect(page.getByRole('alert')).toHaveText('File exceeds 50 MB');
    } finally {
      await context.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
