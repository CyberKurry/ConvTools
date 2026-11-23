import { describe, expect, it } from 'vitest';
import type { ToolModuleManifest } from '../../../core/module-sdk/manifest';
import { createCatalog } from '../../../core/registry/catalog';
import { MemoryArea } from '../../../core/storage/browser-storage';
import { createModuleStorage } from '../../../core/storage/module-storage';
import { PersistenceGuard, PersistenceBlockedError } from '../../../core/storage/persistence-guard';
import { createKernel } from '../../../core/kernel';
import { createSettingsRepository } from '../../../core/storage/settings-repository';

const catalog = createCatalog([
  {
    id: 'alpha-tool',
    version: '1.0.0',
    coreApiRange: '^1.0.0',
    icon: 'icon.svg',
    defaultEnabled: true,
    defaultQuickOrder: 10,
    surfaces: { popup: true, workbench: true, settings: false, selectionActions: [] },
    permissions: { optionalPermissions: [], optionalHostPermissions: [] },
  } satisfies ToolModuleManifest,
]);

describe('incognito persistence guard', () => {
  it('reads settings but blocks every sync/local/session write', async () => {
    const sync = new MemoryArea({ theme: 'dark' });
    const local = new MemoryArea({ historyEnabled: true, schemaVersion: 1 });
    const session = new MemoryArea({ token: 'nope' });
    const guard = new PersistenceGuard(true);
    const repo = createSettingsRepository({ sync, local, catalog, guard });
    const settings = await repo.read();
    expect(settings.sync.theme).toBe('dark');
    expect(settings.local.historyEnabled).toBe(true);
    await expect(repo.writeSync({ theme: 'light' })).rejects.toBeInstanceOf(PersistenceBlockedError);
    await expect(repo.writeLocal({ historyEnabled: false })).rejects.toBeInstanceOf(PersistenceBlockedError);
    await expect(guard.write(session, { token: 'x' })).rejects.toBeInstanceOf(PersistenceBlockedError);
    expect(sync.snapshot()).toEqual({ theme: 'dark' });
    expect(local.snapshot()).toEqual({ historyEnabled: true, schemaVersion: 1 });
    expect(session.snapshot()).toEqual({ token: 'nope' });
  });

  it('does not reject a clear-history request in incognito (L)', async () => {
    const kernel = createKernel({ storageSync: new MemoryArea(), storageLocal: new MemoryArea(), incognito: true });
    await kernel.setup();
    // The options page fires this as `void kernel.clearHistory(...)`: an
    // incognito block must be a no-op, not an unhandled rejection with no UI
    // to report it.
    await expect(kernel.clearHistory()).resolves.toBeUndefined();
    await expect(kernel.clearHistory('base64')).resolves.toBeUndefined();
  });

  it('keeps namespaced module writes in memory without touching the shared area', async () => {
    const area = new MemoryArea();
    const storage = createModuleStorage('alpha-tool', area, new PersistenceGuard(true));
    // Spec §4.4: incognito setting changes land in an in-memory overlay and
    // never persist, but the module UI keeps working on them.
    await storage.set('flag', true);
    expect(area.snapshot()).toEqual({});
    expect(await storage.get<boolean>('flag')).toBe(true);
  });
});
