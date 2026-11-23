import { createServer, type Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { launchExtensionContext, openExtensionPage } from './extension-context';

interface Fixture {
  readonly server: Server;
  readonly url: string;
}

async function startFixture(): Promise<Fixture> {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      // No script or page-global style is allowed. Extension injection must
      // work through the real scripting/content path and Shadow DOM boundary.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>Metadata fixture</title>
          <meta name="description" content="A fixture description">
          <meta property="og:title" content="Open Graph title">
          <meta property="og:description" content="Open Graph description">
          <meta property="og:site_name" content="Fixture Site">
        </head>
        <body><p id="target">hello world</p></body>
      </html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeFixture(server);
    throw new Error('fixture server did not expose a TCP address');
  }
  return { server, url: `http://127.0.0.1:${address.port}/article` };
}

async function closeFixture(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function triggerFromExtensionPage(
  sender: Page,
  moduleId: string,
  actionId: string,
  selectionText: string,
): Promise<void> {
  await sender.evaluate(
    ({ moduleId: id, actionId: action, selectionText: text }) => {
      const runtime = (globalThis as { browser?: { runtime?: { sendMessage(message: unknown): Promise<unknown> } } }).browser?.runtime;
      if (!runtime) {
        throw new Error('extension runtime unavailable');
      }
      return runtime.sendMessage({
        kind: 'request',
        type: 'CONVTOOLS_TEST_SHOW_OVERLAY',
        id: 'e2e',
        payload: {
        moduleId: id,
        actionId: action,
        selectionText: text,
      },
      });
    },
    { moduleId, actionId, selectionText },
  );
}

async function shadowText(page: Page): Promise<string> {
  return page.evaluate(() => document.getElementById('convtools-overlay-root')?.shadowRoot?.textContent ?? '');
}

test.describe('real web-page integration', () => {
  test('injects the overlay through a strict-CSP page and Shadow DOM', async () => {
    test.setTimeout(60_000);
    const fixture = await startFixture();
    const { context, extensionId } = await launchExtensionContext();
    try {
      const sender = await openExtensionPage(context, extensionId, 'workbench');
      const page = await context.newPage();
      await page.goto(fixture.url);
      await page.bringToFront();
      await triggerFromExtensionPage(sender, 'base64', 'decode', 'SGVsbG8=');
      await expect
        .poll(() => shadowText(page), { timeout: 15_000 })
        .toContain('Hello');
      await expect(page.locator('#convtools-overlay-root')).toHaveCount(1);
      expect(await page.evaluate(() => document.getElementById('convtools-overlay-root')?.shadowRoot !== null)).toBe(true);
    } finally {
      await context.close();
      await closeFixture(fixture.server);
    }
  });

  test('shows the module-localized conversion failure inside the overlay (H4)', async () => {
    test.setTimeout(60_000);
    const fixture = await startFixture();
    const { context, extensionId } = await launchExtensionContext();
    try {
      const sender = await openExtensionPage(context, extensionId, 'workbench');
      const page = await context.newPage();
      await page.goto(fixture.url);
      await page.bringToFront();
      // A real conversion failure: the background puts the module's localized
      // message in the payload, and the overlay must render it instead of the
      // generic "Something went wrong." fallback.
      await triggerFromExtensionPage(sender, 'base64', 'decode', '!!!!');
      await expect
        .poll(() => shadowText(page), { timeout: 15_000 })
        .toContain('Invalid character in Base64 input.');
      await expect
        .poll(() => shadowText(page), { timeout: 5_000 })
        .not.toContain('Something went wrong.');
    } finally {
      await context.close();
      await closeFixture(fixture.server);
    }
  });

  test('probes real page metadata and routes it into the share-card editor', async () => {
    test.setTimeout(60_000);
    const fixture = await startFixture();
    const { context, extensionId } = await launchExtensionContext();
    try {
      const sender = await openExtensionPage(context, extensionId, 'workbench');
      const source = await context.newPage();
      await source.goto(fixture.url);
      await source.bringToFront();
      const handoff = context.waitForEvent('page', { timeout: 15_000 });
      await triggerFromExtensionPage(sender, 'share-card', 'generate', 'quoted words');
      const editor = await handoff;
      await expect(editor).toHaveURL(/workbench\.html/);
      await expect(editor.getByLabel('Excerpt')).toHaveValue('quoted words');
      await expect(editor.getByLabel('Page title')).toHaveValue('Open Graph title');
      await expect(editor.getByLabel('Summary')).toHaveValue('Open Graph description');
      await expect(editor.getByLabel('Site name')).toHaveValue('Fixture Site');
      await expect(editor.getByLabel('Link')).toHaveValue(fixture.url);
    } finally {
      await context.close();
      await closeFixture(fixture.server);
    }
  });
});
