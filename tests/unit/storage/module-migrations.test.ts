import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModuleMigration } from '../../../core/module-sdk/runtime';
import { MemoryArea, type StorageArea, type StorageValue } from '../../../core/storage/browser-storage';
import { runModuleMigrations } from '../../../core/storage/module-migrations';
import { PersistenceGuard } from '../../../core/storage/persistence-guard';

const VERSION_KEY = 'module:alpha-tool:schemaVersion';

function area(initial: Record<string, StorageValue> = {}): MemoryArea {
  return new MemoryArea(initial);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('module migration executor', () => {
  it('migrates a stored namespace and stamps the new version', async () => {
    const storage = area({ 'module:alpha-tool:payload': { text: 'old' } });
    const migrations: ModuleMigration[] = [
      {
        fromVersion: 0,
        migrate: (data) => {
          const record = data as { payload: { text: string } };
          return { payload: { text: record.payload.text.toUpperCase() } };
        },
      },
    ];
    const result = await runModuleMigrations({
      moduleId: 'alpha-tool',
      migrations,
      area: storage,
      guard: new PersistenceGuard(false),
    });
    expect(result).toMatchObject({ status: 'migrated', from: 0, to: 1 });
    expect(storage.snapshot()).toEqual({
      'module:alpha-tool:payload': { text: 'OLD' },
      [VERSION_KEY]: 1,
    });
  });

  it('runs a chain of migrations in order', async () => {
    const calls: number[] = [];
    const migrations: ModuleMigration[] = [
      {
        fromVersion: 0,
        migrate: (data) => {
          calls.push(0);
          const { payload, ...rest } = data as { payload: string };
          return { ...rest, data: payload };
        },
      },
      {
        fromVersion: 1,
        migrate: (data) => {
          calls.push(1);
          const { data: value } = data as { data: string };
          return { data: { value } };
        },
      },
    ];
    const storage = area({ 'module:alpha-tool:payload': 'x' });
    const result = await runModuleMigrations({
      moduleId: 'alpha-tool',
      migrations,
      area: storage,
      guard: new PersistenceGuard(false),
    });
    expect(calls).toEqual([0, 1]);
    expect(result).toMatchObject({ status: 'migrated', from: 0, to: 2 });
    // The renamed key replaced the old one instead of accumulating both.
    expect(storage.snapshot()).toEqual({
      'module:alpha-tool:data': { value: 'x' },
      [VERSION_KEY]: 2,
    });
  });

  it('does nothing when the stored version is already current', async () => {
    const migrate = vi.fn();
    const storage = area({ 'module:alpha-tool:payload': 'kept', [VERSION_KEY]: 1 });
    const result = await runModuleMigrations({
      moduleId: 'alpha-tool',
      migrations: [{ fromVersion: 0, migrate }],
      area: storage,
      guard: new PersistenceGuard(false),
    });
    expect(result).toMatchObject({ status: 'skipped', from: 1, to: 1 });
    expect(migrate).not.toHaveBeenCalled();
    expect(storage.snapshot()['module:alpha-tool:payload']).toBe('kept');
  });

  it('stamps a fresh install without running data migrations', async () => {
    const migrate = vi.fn();
    const storage = area();
    const result = await runModuleMigrations({
      moduleId: 'alpha-tool',
      migrations: [{ fromVersion: 0, migrate }],
      area: storage,
      guard: new PersistenceGuard(false),
    });
    expect(result).toMatchObject({ status: 'stamped', from: 0, to: 1 });
    expect(migrate).not.toHaveBeenCalled();
    // The stamp matters: data written later by the current shape must not be
    // fed through the v0 migration.
    expect(storage.snapshot()[VERSION_KEY]).toBe(1);
  });

  it('retains the previous record and reports failure when a migration throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storage = area({ 'module:alpha-tool:payload': 'original' });
    const result = await runModuleMigrations({
      moduleId: 'alpha-tool',
      migrations: [{ fromVersion: 0, migrate: () => { throw new Error('boom'); } }],
      area: storage,
      guard: new PersistenceGuard(false),
    });
    expect(result).toMatchObject({ status: 'failed', from: 0, to: 1 });
    expect(result.code).toBe('STORAGE_MIGRATION_FAILED');
    expect(storage.snapshot()).toEqual({ 'module:alpha-tool:payload': 'original' });
    expect(errorSpy).toHaveBeenCalledWith('STORAGE_MIGRATION_FAILED', 'alpha-tool');
  });

  it('fails without writing when the declared chain has a gap', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storage = area({ 'module:alpha-tool:payload': 'original' });
    const result = await runModuleMigrations({
      moduleId: 'alpha-tool',
      migrations: [{ fromVersion: 2, migrate: () => ({ payload: 'skipped-ahead' }) }],
      area: storage,
      guard: new PersistenceGuard(false),
    });
    expect(result.status).toBe('failed');
    expect(storage.snapshot()).toEqual({ 'module:alpha-tool:payload': 'original' });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('drops keys the migration removed and never touches other namespaces', async () => {
    const storage = area({
      'module:alpha-tool:legacy': 'gone',
      'module:alpha-tool:payload': 'kept',
      'module:zeta-tool:payload': 'other module',
    });
    const result = await runModuleMigrations({
      moduleId: 'alpha-tool',
      migrations: [{ fromVersion: 0, migrate: (data) => ({ payload: (data as { payload: string }).payload }) }],
      area: storage,
      guard: new PersistenceGuard(false),
    });
    expect(result.status).toBe('migrated');
    expect(storage.snapshot()).toEqual({
      'module:alpha-tool:payload': 'kept',
      'module:zeta-tool:payload': 'other module',
      [VERSION_KEY]: 1,
    });
  });

  it('never writes in incognito', async () => {
    const storage = area({ 'module:alpha-tool:payload': 'original' });
    const result = await runModuleMigrations({
      moduleId: 'alpha-tool',
      migrations: [{ fromVersion: 0, migrate: () => ({ payload: 'migrated' }) }],
      area: storage,
      guard: new PersistenceGuard(true),
    });
    expect(result.status).toBe('skipped');
    expect(storage.snapshot()).toEqual({ 'module:alpha-tool:payload': 'original' });
  });

  it('rolls back and reports when the commit itself fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storage = area({ 'module:alpha-tool:payload': 'original' });
    const failing: StorageArea = {
      get: (keys) => storage.get(keys),
      set: () => Promise.reject(new Error('quota exceeded')),
      remove: (keys) => storage.remove(keys),
      clear: () => storage.clear(),
    };
    const result = await runModuleMigrations({
      moduleId: 'alpha-tool',
      migrations: [{ fromVersion: 0, migrate: () => ({ payload: 'migrated' }) }],
      area: failing,
      guard: new PersistenceGuard(false),
    });
    expect(result).toMatchObject({ status: 'failed', code: 'STORAGE_MIGRATION_FAILED' });
    expect(storage.snapshot()).toEqual({ 'module:alpha-tool:payload': 'original' });
    expect(errorSpy).toHaveBeenCalledWith('STORAGE_MIGRATION_FAILED', 'alpha-tool');
  });

  it('is a no-op for a module that declares no migrations', async () => {
    const storage = area({ 'module:alpha-tool:payload': 'original' });
    const result = await runModuleMigrations({
      moduleId: 'alpha-tool',
      migrations: [],
      area: storage,
      guard: new PersistenceGuard(false),
    });
    expect(result.status).toBe('skipped');
    expect(storage.snapshot()).toEqual({ 'module:alpha-tool:payload': 'original' });
  });
});
