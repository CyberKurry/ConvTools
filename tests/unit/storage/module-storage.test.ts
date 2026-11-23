import { describe, expect, it } from 'vitest';
import { MemoryArea } from '../../../core/storage/browser-storage';
import { createModuleStorage } from '../../../core/storage/module-storage';
import { PersistenceGuard } from '../../../core/storage/persistence-guard';
import { migrateRecord, STORAGE_MIGRATION_FAILED } from '../../../core/storage/migrations';

describe('module storage', () => {
  it('namespaces keys by module id', async () => {
    const area = new MemoryArea();
    const alpha = createModuleStorage('alpha-tool', area, new PersistenceGuard(false));
    const zeta = createModuleStorage('zeta-tool', area, new PersistenceGuard(false));
    await alpha.set('flag', true);
    await zeta.set('flag', false);
    expect(await alpha.get<boolean>('flag')).toBe(true);
    expect(await zeta.get<boolean>('flag')).toBe(false);
    expect(Object.keys(area.snapshot())).toEqual(['module:alpha-tool:flag', 'module:zeta-tool:flag']);
  });

  it('retains a vanished module namespace instead of deleting it', async () => {
    const area = new MemoryArea({ 'module:ghost-tool:keep': 1 });
    const storage = createModuleStorage('alpha-tool', area, new PersistenceGuard(false));
    await storage.set('ok', true);
    expect(area.snapshot()['module:ghost-tool:keep']).toBe(1);
  });

  it('rolls back a failed schema migration and reports STORAGE_MIGRATION_FAILED', () => {
    const previous = { schemaVersion: 1, value: 'keep-me' };
    const result = migrateRecord(previous, {
      targetVersion: 2,
      migrate: () => {
        throw new Error('corrupt');
      },
      validate: (record) => record,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(STORAGE_MIGRATION_FAILED);
      expect(result.retained).toEqual(previous);
    }
  });

  it('commits a validated migration copy', () => {
    const previous = { schemaVersion: 1, value: 'old' };
    const result = migrateRecord(previous, {
      targetVersion: 2,
      migrate: (record) => ({ ...record, schemaVersion: 2, value: 'new' }),
      validate: (record) => {
        if (record.schemaVersion !== 2) {
          throw new Error('invalid');
        }
        return record;
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record).toEqual({ schemaVersion: 2, value: 'new' });
    }
  });

  describe('incognito overlay', () => {
    it('never touches the shared area on writes', async () => {
      const area = new MemoryArea();
      const storage = createModuleStorage('alpha-tool', area, new PersistenceGuard(true));
      await storage.set('template', 'paper');
      expect(area.snapshot()).toEqual({});
      expect(await storage.get<string>('template')).toBe('paper');
    });

    it('reads the overlay first, then falls back to the shared area', async () => {
      const area = new MemoryArea({ 'module:alpha-tool:template': 'ink' });
      const storage = createModuleStorage('alpha-tool', area, new PersistenceGuard(true));
      expect(await storage.get<string>('template')).toBe('ink');
      await storage.set('template', 'paper');
      expect(await storage.get<string>('template')).toBe('paper');
      // The shared value stayed untouched under the overlay.
      expect(area.snapshot()['module:alpha-tool:template']).toBe('ink');
    });

    it('removes and clears only overlay entries, never shared data', async () => {
      const area = new MemoryArea({
        'module:alpha-tool:template': 'shared-template',
        'module:alpha-tool:keep': 'shared',
        'module:zeta-tool:keep': 'shared',
      });
      const storage = createModuleStorage('alpha-tool', area, new PersistenceGuard(true));
      await storage.set('template', 'paper');
      await storage.remove('template');
      expect(await storage.get<string>('template')).toBeUndefined();
      expect(await storage.get<string>('template')).toBeUndefined();
      await storage.set('size', 'portrait');
      await storage.clear();
      expect(await storage.get<string>('size')).toBeUndefined();
      expect(await storage.get<string>('template')).toBeUndefined();
      // Shared entries of this module and every other module survive.
      expect(area.snapshot()['module:alpha-tool:keep']).toBe('shared');
      expect(area.snapshot()['module:zeta-tool:keep']).toBe('shared');
    });

    it('keeps normal-mode behavior byte-for-byte identical', async () => {
      const area = new MemoryArea();
      const storage = createModuleStorage('alpha-tool', area, new PersistenceGuard(false));
      await storage.set('template', 'mist');
      expect(area.snapshot()['module:alpha-tool:template']).toBe('mist');
      await storage.remove('template');
      expect(area.snapshot()).toEqual({});
    });
  });
});
