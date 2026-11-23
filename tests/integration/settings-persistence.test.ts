import { describe, expect, it } from 'vitest';
import { createKernel } from '../../core/kernel';
import { MemoryArea } from '../../core/storage/browser-storage';

describe('settings persistence across kernel instances (assembly)', () => {
  it('exposes settings written by one kernel to a second kernel over the same area', async () => {
    const sharedSync = new MemoryArea();
    const sharedLocal = new MemoryArea();

    const first = createKernel({ storageSync: sharedSync, storageLocal: sharedLocal });
    await first.setup();
    await first.setTheme('dark');
    await first.setLocale('zh_CN');
    await first.setHistoryEnabled(true);
    await first.disableModule('timestamp', false);

    const second = createKernel({ storageSync: sharedSync, storageLocal: sharedLocal });
    // Entry points always run setup (load-once) before snapshotting; the
    // kernel's in-memory state is the source of truth afterwards.
    await second.setup();
    const snapshot = await second.snapshot();

    expect(snapshot.theme).toBe('dark');
    expect(snapshot.locale).toBe('zh_CN');
    expect(snapshot.historyEnabled).toBe(true);
    expect(snapshot.enabledModuleIds).toEqual(['base64', 'share-card']);
  });

  it('keeps defaults when the shared area is empty', async () => {
    const kernel = createKernel({
      storageSync: new MemoryArea(),
      storageLocal: new MemoryArea(),
    });
    await kernel.setup();
    const snapshot = await kernel.snapshot();
    expect(snapshot.theme).toBe('system');
    expect(snapshot.enabledModuleIds).toEqual(['base64', 'share-card', 'timestamp']);
  });
});
