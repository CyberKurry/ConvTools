import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createHistoryService } from '../../../core/history/history-service';
import { HISTORY_DB_NAME } from '../../../core/history/indexed-db';
import { createKernel } from '../../../core/kernel';
import { MemoryArea } from '../../../core/storage/browser-storage';

afterEach(() => {
  indexedDB.deleteDatabase(HISTORY_DB_NAME);
});

describe('kernel persistence semantics', () => {
  it('keeps incognito setting changes in memory, still notifies, and never persists', async () => {
    const sync = new MemoryArea({ theme: 'light' });
    const local = new MemoryArea();
    const kernel = createKernel({ storageSync: sync, storageLocal: local, incognito: true });
    await kernel.setup();

    let notifiedTheme: string | undefined;
    const unsubscribe = kernel.subscribe(() => {
      void kernel.snapshot().then((snapshot) => {
        notifiedTheme = snapshot.theme;
      });
    });
    await expect(kernel.setTheme('dark')).resolves.toBeUndefined();
    await vi_waitFor(() => expect(notifiedTheme).toBe('dark'));
    unsubscribe();

    const snapshot = await kernel.snapshot();
    expect(snapshot.theme).toBe('dark');
    // Spec §14: incognito skips all persistence; the UI must keep working on
    // the in-memory state instead of surfacing a storage failure.
    expect(sync.snapshot().theme).toBe('light');
  });

  it('snapshot reflects pending in-memory settings before the debounced write lands', async () => {
    const kernel = createKernel({ storageSync: new MemoryArea(), storageLocal: new MemoryArea() });
    await kernel.setup();
    // Entry points call kernel setters fire-and-forget (`void kernel.x()`), so
    // a snapshot taken while the debounced write is still pending must observe
    // the in-memory value, not re-read the stale storage copy.
    void kernel.setLocale('en');
    const snapshot = await kernel.snapshot();
    expect(snapshot.locale).toBe('en');
  });

  it('disable with delete also clears the module history', async () => {
    const seed = createHistoryService({ enabled: true, incognito: false });
    await seed.append({
      kind: 'text',
      moduleId: 'base64',
      action: 'encode',
      createdAt: 1,
      input: 'a',
      output: 'YQ==',
    });

    const kernel = createKernel({ storageSync: new MemoryArea(), storageLocal: new MemoryArea() });
    await kernel.setup();
    await kernel.disableModule('base64', true);

    const verify = createHistoryService({ enabled: true, incognito: false });
    expect(await verify.list('base64')).toEqual([]);
  });

  it('stamps the local schema version during setup', async () => {
    const local = new MemoryArea();
    const kernel = createKernel({ storageSync: new MemoryArea(), storageLocal: local });
    await kernel.setup();
    const stored = await local.get(['schemaVersion']);
    expect(stored.schemaVersion).toBe(1);
  });

  it('does not persist quick-list changes it never made over a concurrent context', async () => {
    // Two kernels share storage like popup + options. Context B changes the
    // quick list; a later unrelated write from context A (locale) must not
    // revert it (full-state writes clobbered sibling contexts before).
    const sync = new MemoryArea();
    const localA = new MemoryArea();
    const kernelA = createKernel({ storageSync: sync, storageLocal: localA });
    const kernelB = createKernel({ storageSync: sync, storageLocal: new MemoryArea() });
    await kernelA.setup();
    await kernelB.setup();

    await kernelB.addQuick('timestamp');
    await waitForStorage(() => expect(sync.snapshot().quickModuleIds).toContain('timestamp'));

    await kernelA.setLocale('en');
    await waitForStorage(() => expect(sync.snapshot().locale).toBe('en'));
    expect(sync.snapshot().quickModuleIds).toContain('timestamp');
    expect(sync.snapshot().quickModuleIds).toContain('base64');
  });

  it('never offers a popup-less module in the persisted quick bar', async () => {
    // share-card declares popup:false; a stored quick entry (or an add) must
    // be ignored generically, without a kernel branch on the module id.
    const sync = new MemoryArea({
      quickModuleIds: ['base64', 'share-card'],
      lastQuickModuleId: 'share-card',
    });
    const kernel = createKernel({ storageSync: sync, storageLocal: new MemoryArea() });
    await kernel.setup();

    await kernel.addQuick('share-card');
    const snapshot = await kernel.snapshot();
    expect(snapshot.quickModuleIds).not.toContain('share-card');
    expect(snapshot.lastQuickModuleId).not.toBe('share-card');

    // Dirty-key scoping: an unrelated locale write from this context must not
    // rewrite (and thereby silently revert or reshape) the stored quick list.
    await kernel.setLocale('en');
    await waitForStorage(() => expect(sync.snapshot().locale).toBe('en'));
    expect(sync.snapshot().quickModuleIds).toEqual(['base64', 'share-card']);
  });

  it('lists and clears always-allow send policies per module', async () => {
    const local = new MemoryArea();
    const kernel = createKernel({ storageSync: new MemoryArea(), storageLocal: local });
    await kernel.setup();

    const { policyKey } = await import('../../../core/network/send-policy');
    await local.set({ [policyKey('net-probe', 'https://api.example.com', 'telemetry')]: true });
    await local.set({ [policyKey('net-probe', 'https://api.example.com', 'draft')]: true });
    await local.set({ [policyKey('other-module', 'https://api.example.com', 'telemetry')]: true });

    const policies = await kernel.listSendPolicies('net-probe');
    expect(policies).toEqual([
      { origin: 'https://api.example.com', dataCategory: 'draft' },
      { origin: 'https://api.example.com', dataCategory: 'telemetry' },
    ]);

    await kernel.clearSendPolicies('net-probe');
    expect(await kernel.listSendPolicies('net-probe')).toEqual([]);
    // Other modules' policies survive a per-module purge.
    expect(await kernel.listSendPolicies('other-module')).toEqual([
      { origin: 'https://api.example.com', dataCategory: 'telemetry' },
    ]);
  });
});

async function waitForStorage(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assertion();
}

async function vi_waitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assertion();
}
