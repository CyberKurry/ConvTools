import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolModuleManifest } from '../../../core/module-sdk/manifest';
import { createCatalog } from '../../../core/registry/catalog';
import { MemoryArea } from '../../../core/storage/browser-storage';
import { PersistenceBlockedError, PersistenceGuard } from '../../../core/storage/persistence-guard';
import { createSettingsRepository } from '../../../core/storage/settings-repository';

function manifest(id: string, order: number | null, enabled = true): ToolModuleManifest {
  return {
    id,
    version: '1.0.0',
    coreApiRange: '^1.0.0',
    icon: 'icon.svg',
    defaultEnabled: enabled,
    defaultQuickOrder: order,
    surfaces: { popup: true, workbench: true, settings: false, selectionActions: [] },
    permissions: { optionalPermissions: [], optionalHostPermissions: [] },
  };
}

const catalog = createCatalog([
  manifest('zeta-tool', 20),
  manifest('alpha-tool', 10),
  manifest('hidden-tool', null, false),
]);

afterEach(() => {
  vi.useRealTimers();
});

describe('settings repository', () => {
  it('derives first-install defaults from generated generic catalog fields', async () => {
    const repo = createSettingsRepository({
      sync: new MemoryArea(),
      local: new MemoryArea(),
      catalog,
      guard: new PersistenceGuard(false),
    });
    const settings = await repo.read();
    expect(settings.sync.enabledModuleIds).toEqual(['alpha-tool', 'zeta-tool']);
    expect(settings.sync.quickModuleIds).toEqual(['alpha-tool', 'zeta-tool']);
    expect(settings.sync.locale).toBe('auto');
    expect(settings.sync.theme).toBe('system');
    expect(settings.local.historyEnabled).toBe(false);
    expect(settings.local.schemaVersion).toBe(1);
  });

  it('persists vendor-sync settings separately from device-local settings', async () => {
    const sync = new MemoryArea();
    const local = new MemoryArea();
    const repo = createSettingsRepository({ sync, local, catalog, guard: new PersistenceGuard(false) });
    await repo.writeSync({ theme: 'dark', locale: 'zh_CN' });
    await repo.writeLocal({ historyEnabled: true });
    expect((await sync.get(['theme', 'locale', 'historyEnabled']))).toEqual({
      theme: 'dark',
      locale: 'zh_CN',
    });
    expect((await local.get(['historyEnabled']))).toEqual({ historyEnabled: true });
  });

  it('ignores unknown module IDs in enabled and quick lists', async () => {
    const sync = new MemoryArea({
      enabledModuleIds: ['alpha-tool', 'ghost-tool'],
      quickModuleIds: ['ghost-tool', 'zeta-tool', 'alpha-tool'],
    });
    const repo = createSettingsRepository({
      sync,
      local: new MemoryArea(),
      catalog,
      guard: new PersistenceGuard(false),
    });
    const settings = await repo.read();
    expect(settings.sync.enabledModuleIds).toEqual(['alpha-tool']);
    expect(settings.sync.quickModuleIds).toEqual(['zeta-tool', 'alpha-tool']);
  });

  it('normalizes quick order to unique known enabled modules', async () => {
    const repo = createSettingsRepository({
      sync: new MemoryArea({
        enabledModuleIds: ['alpha-tool', 'zeta-tool'],
        quickModuleIds: ['alpha-tool', 'alpha-tool', 'ghost-tool'],
      }),
      local: new MemoryArea(),
      catalog,
      guard: new PersistenceGuard(false),
    });
    const settings = await repo.read();
    expect(settings.sync.quickModuleIds).toEqual(['alpha-tool']);
  });

  it('debounces sync writes', async () => {
    vi.useFakeTimers();
    const sync = new MemoryArea();
    const spy = vi.spyOn(sync, 'set');
    const repo = createSettingsRepository({
      sync,
      local: new MemoryArea(),
      catalog,
      guard: new PersistenceGuard(false),
      debounceMs: 50,
    });
    const first = repo.writeSync({ theme: 'dark' });
    const second = repo.writeSync({ locale: 'en' });
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    await Promise.all([first, second]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await sync.get(['theme', 'locale'])).toEqual({ theme: 'dark', locale: 'en' });
  });

  it('schedules a retry when a sync flush fails transiently', async () => {
    vi.useFakeTimers();
    const sync = new MemoryArea();
    const spy = vi
      .spyOn(sync, 'set')
      .mockImplementationOnce(() => Promise.reject(new Error('quota exceeded')));
    const repo = createSettingsRepository({
      sync,
      local: new MemoryArea(),
      catalog,
      guard: new PersistenceGuard(false),
      debounceMs: 10,
    });
    const first = repo.writeSync({ locale: 'en' });
    // Attach the rejection assertion before advancing the fake clock: the
    // flush rejects during `advanceTimersByTimeAsync`, and an unobserved
    // rejection would surface as an unhandled rejection.
    const firstAssertion = expect(first).rejects.toThrow('quota exceeded');
    await vi.advanceTimersByTimeAsync(10);
    await firstAssertion;
    // The failed patch is still buffered and a delayed retry flushes it even
    // if the user makes no further setting changes.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await sync.get(['locale'])).toEqual({ locale: 'en' });
  });

  it('does not retry forever when persistence is blocked (incognito)', async () => {
    vi.useFakeTimers();
    const sync = new MemoryArea();
    const spy = vi.spyOn(sync, 'set');
    const repo = createSettingsRepository({
      sync,
      local: new MemoryArea(),
      catalog,
      guard: new PersistenceGuard(true),
      debounceMs: 10,
    });
    const first = repo.writeSync({ locale: 'en' });
    const firstAssertion = expect(first).rejects.toBeInstanceOf(PersistenceBlockedError);
    await vi.advanceTimersByTimeAsync(10);
    await firstAssertion;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spy).not.toHaveBeenCalled();
  });

  it('stops retrying a persistently failing sync write (H5)', async () => {
    vi.useFakeTimers();
    const sync = new MemoryArea();
    const spy = vi.spyOn(sync, 'set').mockImplementation(() => Promise.reject(new Error('quota exceeded')));
    const repo = createSettingsRepository({
      sync,
      local: new MemoryArea(),
      catalog,
      guard: new PersistenceGuard(false),
      debounceMs: 10,
    });
    const first = repo.writeSync({ locale: 'en' });
    const firstAssertion = expect(first).rejects.toThrow('quota exceeded');
    await vi.advanceTimersByTimeAsync(10);
    await firstAssertion;
    // A storage.sync quota failure used to reschedule itself forever, giving
    // an endless write loop (and log spam) with no user action involved.
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(spy.mock.calls.length).toBeGreaterThan(1);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('re-arms the retry budget when a new setting is written (H5)', async () => {
    vi.useFakeTimers();
    const sync = new MemoryArea();
    const originalSet = sync.set.bind(sync);
    let fail = true;
    const spy = vi.spyOn(sync, 'set').mockImplementation(async (items) => {
      if (fail) {
        throw new Error('quota exceeded');
      }
      await originalSet(items);
    });
    const repo = createSettingsRepository({
      sync,
      local: new MemoryArea(),
      catalog,
      guard: new PersistenceGuard(false),
      debounceMs: 10,
    });
    const first = repo.writeSync({ locale: 'en' });
    const firstAssertion = expect(first).rejects.toThrow('quota exceeded');
    await vi.advanceTimersByTimeAsync(10);
    await firstAssertion;
    await vi.advanceTimersByTimeAsync(60_000);
    const attemptsAfterCap = spy.mock.calls.length;
    // The user changes another setting: a fresh budget must be allowed.
    fail = false;
    const second = repo.writeSync({ theme: 'dark' });
    await vi.advanceTimersByTimeAsync(10);
    await second;
    expect(spy.mock.calls.length).toBeGreaterThan(attemptsAfterCap);
    expect(await sync.get(['theme', 'locale'])).toEqual({ theme: 'dark', locale: 'en' });
  });

  it('flushes a debounced write immediately so a closing popup cannot drop it (B3)', async () => {
    vi.useFakeTimers();
    const sync = new MemoryArea();
    const repo = createSettingsRepository({
      sync,
      local: new MemoryArea(),
      catalog,
      guard: new PersistenceGuard(false),
      debounceMs: 250,
    });
    const pending = repo.writeSync({ theme: 'dark' });
    expect(await sync.get(['theme'])).toEqual({});
    // pagehide path: no time left for the debounce window.
    await repo.flush();
    await pending;
    expect(await sync.get(['theme'])).toEqual({ theme: 'dark' });
  });
});
