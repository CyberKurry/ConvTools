import { describe, expect, it, vi } from 'vitest';
import { createKernel } from '../../../core/kernel';
import type * as generated from '../../../generated/module-registry';
import { MemoryArea } from '../../../core/storage/browser-storage';

vi.mock('../../../generated/module-registry', async (importOriginal) => {
  const original = await importOriginal<typeof generated>();
  return {
    ...original,
    moduleLoaders: {
      ...original.moduleLoaders,
      base64: () => Promise.reject(new Error('activation exploded')),
    },
  };
});

describe('kernel activation failures', () => {
  it('does not report a module whose activation failed as enabled', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const kernel = createKernel({ storageSync: new MemoryArea(), storageLocal: new MemoryArea() });
      await kernel.setup();
      const snapshot = await kernel.snapshot();
      const base64 = snapshot.modules.find((module) => module.id === 'base64');
      expect(base64?.enabled).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith('MODULE_ACTIVATION_FAILED', 'base64', 'Error');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('drops a failed activation from the quick bar and the last-used pointer', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const kernel = createKernel({ storageSync: new MemoryArea(), storageLocal: new MemoryArea() });
      await kernel.setup();
      const snapshot = await kernel.snapshot();
      // base64 fails to activate here, so the default quick order must not
      // advertise it (the snapshot's quick ids are all enabled ids).
      expect(snapshot.quickModuleIds).not.toContain('base64');
      expect(snapshot.lastQuickModuleId).not.toBe('base64');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('persists the disabled state so other contexts and restarts agree (H3)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const sync = new MemoryArea();
      const local = new MemoryArea();
      const kernel = createKernel({ storageSync: sync, storageLocal: local });
      await kernel.setup();
      await vi.waitFor(async () => {
        const stored = await sync.get(['enabledModuleIds']);
        expect(stored.enabledModuleIds).not.toContain('base64');
      });
      // The background reads storage directly for its context menus, so the
      // in-memory deletion must be written out during setup itself.
      const stored = await sync.get(['enabledModuleIds', 'quickModuleIds']);
      expect(Array.isArray(stored.enabledModuleIds), 'setup must persist the enabled id list').toBe(true);
      expect(stored.enabledModuleIds as string[]).not.toContain('base64');
      expect(stored.quickModuleIds as string[]).not.toContain('base64');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('keeps a failed enable request from rejecting into its void caller (M4)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const kernel = createKernel({ storageSync: new MemoryArea(), storageLocal: new MemoryArea() });
      await kernel.setup();
      // Entrypoints call `void kernel.enableModule(id)`: a rejection here is
      // an unhandled promise rejection with no UI path, so activation failure
      // stays a logged, disabled state exactly like setup().
      await expect(kernel.enableModule('base64')).resolves.toBeUndefined();
      const snapshot = await kernel.snapshot();
      expect(snapshot.modules.find((module) => module.id === 'base64')?.enabled).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith('MODULE_ACTIVATION_FAILED', 'base64', 'Error');

    } finally {
      errorSpy.mockRestore();
    }
  });
});
