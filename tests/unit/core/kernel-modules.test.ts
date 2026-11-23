import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createKernel } from '../../../core/kernel';
import { MemoryArea } from '../../../core/storage/browser-storage';

function makeKernel() {
  const storageSync = new MemoryArea();
  const storageLocal = new MemoryArea();
  const kernel = createKernel({ storageSync, storageLocal });
  return { kernel, storageSync, storageLocal };
}

describe('kernel module lifecycle guards', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('reorders a quick module across multiple positions in one step', async () => {
    const { kernel } = makeKernel();
    await kernel.setup();
    // default order: base64, timestamp → move timestamp to index 0
    await kernel.reorderQuick('timestamp', 0);
    const snapshot = await kernel.snapshot();
    expect(snapshot.quickModuleIds).toEqual(['timestamp', 'base64']);
  });

  it('ignores out-of-range reorder targets', async () => {
    const { kernel } = makeKernel();
    await kernel.setup();
    await kernel.reorderQuick('base64', 5);
    const snapshot = await kernel.snapshot();
    expect(snapshot.quickModuleIds).toEqual(['base64', 'timestamp']);
  });

  it('rejects enabling an unknown module without persisting it', async () => {
    const { kernel } = makeKernel();
    await kernel.setup();
    await kernel.enableModule('no-such-module');
    const snapshot = await kernel.snapshot();
    // Default-enabled set in manifest order: base64, share-card, timestamp.
    expect(snapshot.enabledModuleIds).toEqual(['base64', 'share-card', 'timestamp']);
  });

  it('persists disable-with-delete and clears the module namespace', async () => {
    const { kernel, storageLocal } = makeKernel();
    await kernel.setup();
    await kernel.disableModule('base64', true);
    const snapshot = await kernel.snapshot();
    expect(snapshot.enabledModuleIds).toEqual(['share-card', 'timestamp']);
    const stored = await storageLocal.get();
    expect(Object.keys(stored).some((key) => key.startsWith('module:base64:'))).toBe(false);
  });

  it('removes the module always-allow send policies on disable-with-delete (M5)', async () => {
    const { kernel, storageLocal } = makeKernel();
    await kernel.setup();
    await storageLocal.set({
      'sendPolicy:base64|https%3A%2F%2Fexample.com|text': true,
      'sendPolicy:timestamp|https%3A%2F%2Fexample.com|text': true,
    });
    await kernel.disableModule('base64', true);
    const stored = await storageLocal.get();
    expect(Object.keys(stored).filter((key) => key.startsWith('sendPolicy:'))).toEqual([
      'sendPolicy:timestamp|https%3A%2F%2Fexample.com|text',
    ]);
  });

  it('keeps send policies when a module is disabled without deleting data', async () => {
    const { kernel, storageLocal } = makeKernel();
    await kernel.setup();
    await storageLocal.set({ 'sendPolicy:base64|https%3A%2F%2Fexample.com|text': true });
    await kernel.disableModule('base64', false);
    const stored = await storageLocal.get();
    expect(stored['sendPolicy:base64|https%3A%2F%2Fexample.com|text']).toBe(true);
  });

  it('removes disabled modules from the quick list loaded from settings', async () => {
    const kernel = createKernel({
      storageSync: new MemoryArea({
        enabledModuleIds: ['base64'],
        quickModuleIds: ['timestamp', 'base64'],
        lastQuickModuleId: 'timestamp',
      }),
      storageLocal: new MemoryArea(),
    });
    await kernel.setup();
    const snapshot = await kernel.snapshot();
    expect(snapshot.quickModuleIds).toEqual(['base64']);
    expect(snapshot.lastQuickModuleId).toBe('base64');
  });

  it('ignores selection of a module that is not enabled and quick', async () => {
    const { kernel } = makeKernel();
    await kernel.setup();
    await kernel.selectQuick('share-card');
    expect((await kernel.snapshot()).lastQuickModuleId).toBe('base64');
  });
});
