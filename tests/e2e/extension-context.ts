import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXTENSION_DIR = path.join(ROOT, '.output', 'chrome-mv3-test');

export async function launchExtensionContext(): Promise<{
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
}> {
  if (!fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'))) {
    throw new Error(
      `missing test build at ${EXTENSION_DIR}; run \`pnpm build:e2e\` first (plain \`pnpm test:e2e\` must not reuse stale artifacts)`,
    );
  }
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    // Share-card export tests assert real download events from <a download>.
    acceptDownloads: true,
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) {
    // Wait briefly for the MV3 service worker to register.
    await context.waitForEvent('serviceworker', { timeout: 10_000 }).catch(() => undefined);
    worker = context.serviceWorkers()[0];
  }
  const extensionId = worker?.url().split('/')[2];
  if (!extensionId || !worker) {
    throw new Error('could not derive extension id from service worker');
  }
  return { context, extensionId, serviceWorker: worker };
}

export function extensionUrl(extensionId: string, pageName: string): string {
  return `chrome-extension://${extensionId}/${pageName}.html`;
}

export async function openExtensionPage(context: BrowserContext, extensionId: string, pageName: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(extensionUrl(extensionId, pageName));
  return page;
}
