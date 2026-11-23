import { describe, expect, it, vi } from 'vitest';
import { createKernel } from '../../../core/kernel';
import { MemoryArea } from '../../../core/storage/browser-storage';
import type * as generated from '../../../generated/module-registry';
import type { ToolModuleDefinition } from '../../../core/module-sdk/runtime';

/**
 * Swaps one module's loader for a definition that declares migrations, so the
 * kernel's activation path can be observed running them.
 */
function mockLoaderWith(definition: ToolModuleDefinition): void {
  vi.doMock('../../../generated/module-registry', async (importOriginal) => {
    const original = await importOriginal<typeof generated>();
    return {
      ...original,
      moduleLoaders: {
        ...original.moduleLoaders,
        // A real catalog id: the kernel only activates modules it knows.
        base64: () => Promise.resolve({ default: definition }),
      },
    };
  });
}

function migratingDefinition(migrate: (data: unknown) => unknown): ToolModuleDefinition {
  return {
    id: 'base64',
    version: '1.0.0',
    coreApiRange: '^1.0.0',
    icon: 'icon.svg',
    surfaces: { popup: null, workbench: null, settings: null, selectionActions: [] },
    permissions: { optionalPermissions: [], optionalHostPermissions: [] },
    migrations: [{ fromVersion: 0, migrate }],
  };
}

/** Only the module namespace: the kernel also stamps extension-level keys. */
function moduleKeys(area: MemoryArea): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(area.snapshot()).filter(([key]) => key.startsWith('module:')),
  );
}

async function bootKernel(storageLocal: MemoryArea, storageSync: MemoryArea) {
  const { createKernel: create } = await import('../../../core/kernel');
  return create({ storageSync, storageLocal });
}

describe('kernel module migrations', () => {
  it('migrates an enabled module namespace before activation', async () => {
    vi.resetModules();
    const order: string[] = [];
    mockLoaderWith(
      migratingDefinition((data) => {
        order.push('migrate');
        return { ...(data as object), migrated: true };
      }),
    );
    const storageLocal = new MemoryArea({ 'module:base64:payload': 'old' });
    const storageSync = new MemoryArea({ enabledModuleIds: ['base64'] });
    const kernel = await bootKernel(storageLocal, storageSync);
    await kernel.setup();

    expect(order).toEqual(['migrate']);
    expect(moduleKeys(storageLocal)).toEqual({
      'module:base64:payload': 'old',
      'module:base64:migrated': true,
      'module:base64:schemaVersion': 1,
    });
    vi.doUnmock('../../../generated/module-registry');
    vi.resetModules();
    void createKernel;
  });

  it('keeps the old data and still activates when a migration fails', async () => {
    vi.resetModules();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mockLoaderWith(
        migratingDefinition(() => {
          throw new Error('migration exploded');
        }),
      );
      const storageLocal = new MemoryArea({ 'module:base64:payload': 'old' });
      const storageSync = new MemoryArea({ enabledModuleIds: ['base64'] });
      const kernel = await bootKernel(storageLocal, storageSync);
      await kernel.setup();

      expect(moduleKeys(storageLocal)).toEqual({ 'module:base64:payload': 'old' });
      expect(errorSpy).toHaveBeenCalledWith('STORAGE_MIGRATION_FAILED', 'base64');
      const snapshot = await kernel.snapshot();
      // A failed migration is reported, not fatal: the module still loads.
      expect(snapshot.enabledModuleIds).toContain('base64');
    } finally {
      errorSpy.mockRestore();
      vi.doUnmock('../../../generated/module-registry');
      vi.resetModules();
    }
  });

  it('migrates when the user enables a module after startup', async () => {
    vi.resetModules();
    const migrate = vi.fn((data: unknown) => ({ ...(data as object), migrated: true }));
    mockLoaderWith(migratingDefinition(migrate));
    const storageLocal = new MemoryArea({ 'module:base64:payload': 'old' });
    const storageSync = new MemoryArea({ enabledModuleIds: [] });
    const kernel = await bootKernel(storageLocal, storageSync);
    await kernel.setup();
    expect(migrate).not.toHaveBeenCalled();

    await kernel.enableModule('base64');
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(moduleKeys(storageLocal)['module:base64:schemaVersion']).toBe(1);
    vi.doUnmock('../../../generated/module-registry');
    vi.resetModules();
  });
});
