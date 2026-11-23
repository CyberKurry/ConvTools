import type { ModuleMigration } from '../module-sdk/runtime';
import type { StorageArea, StorageValue } from './browser-storage';
import { migrateRecord, STORAGE_MIGRATION_FAILED } from './migrations';
import type { PersistenceGuard } from './persistence-guard';

/** Marks the schema version inside a module's namespace. */
export function moduleSchemaVersionKey(moduleId: string): string {
  return `module:${moduleId}:schemaVersion`;
}

export type ModuleMigrationStatus = 'skipped' | 'stamped' | 'migrated' | 'failed';

export interface ModuleMigrationOutcome {
  readonly status: ModuleMigrationStatus;
  /** Version found in storage (0 when the module never stamped one). */
  readonly from: number;
  /** Version the declared chain reaches. */
  readonly to: number;
  readonly code?: typeof STORAGE_MIGRATION_FAILED;
}

interface VersionedSnapshot extends Record<string, StorageValue> {
  schemaVersion: number;
}

/**
 * Applies a module's declared migrations to its namespaced storage
 * (`module:<id>:*`) before the module is activated (spec §8.3: persisted
 * structures change only through explicit, testable migrations).
 *
 * Contract:
 * - The migration sees the module's whole namespace (sans version marker) as a
 *   plain record and returns the replacement namespace, so it may add, change,
 *   or drop keys; other modules' namespaces are never touched.
 * - Copy-validate-commit: a throwing or non-object-returning migration leaves
 *   the previous data untouched and reports STORAGE_MIGRATION_FAILED (spec
 *   §15 storage failure row).
 * - A namespace with no version marker and no data is stamped with the current
 *   version instead of migrated, so freshly written data is never fed through
 *   an old migration later.
 * - Incognito skips the run entirely: the guard blocks every persistent write
 *   and the session must not mutate the shared area.
 */
export async function runModuleMigrations(
  options: ModuleMigrationOptions,
): Promise<ModuleMigrationOutcome> {
  try {
    return await execute(options);
  } catch {
    // Storage failures (quota, unavailable area) roll the migration back and
    // are reported, but must never break module activation (spec §15).
    console.error(STORAGE_MIGRATION_FAILED, options.moduleId);
    return { status: 'failed', from: 0, to: 0, code: STORAGE_MIGRATION_FAILED };
  }
}

export interface ModuleMigrationOptions {
  readonly moduleId: string;
  readonly migrations: readonly ModuleMigration[];
  readonly area: StorageArea;
  readonly guard: PersistenceGuard;
}

async function execute(options: ModuleMigrationOptions): Promise<ModuleMigrationOutcome> {
  const { moduleId, migrations } = options;
  const ordered = [...migrations].sort((a, b) => a.fromVersion - b.fromVersion);
  const target = ordered.reduce((highest, migration) => Math.max(highest, migration.fromVersion + 1), 0);
  if (ordered.length === 0) {
    return { status: 'skipped', from: 0, to: 0 };
  }
  if (options.guard.blocked) {
    // Reading is fine, writing is not: leave the shared area alone.
    return { status: 'skipped', from: 0, to: target };
  }

  const prefix = `module:${moduleId}:`;
  const versionKey = moduleSchemaVersionKey(moduleId);
  const stored = await options.area.get();
  const version = readStoredVersion(stored[versionKey]);
  if (version >= target) {
    return { status: 'skipped', from: version, to: target };
  }

  const namespace: Record<string, StorageValue> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (key !== versionKey && key.startsWith(prefix)) {
      namespace[key.slice(prefix.length)] = value;
    }
  }
  if (Object.keys(namespace).length === 0 && stored[versionKey] === undefined) {
    // Nothing to migrate yet: stamp the current version so data written from
    // now on is not treated as an older shape.
    await options.guard.write(options.area, { [versionKey]: target });
    return { status: 'stamped', from: version, to: target };
  }

  let current = version;
  let snapshot: Record<string, StorageValue> = namespace;
  for (const migration of ordered) {
    if (migration.fromVersion !== current) {
      continue;
    }
    const result = migrateRecord<VersionedSnapshot>(
      { ...snapshot, schemaVersion: current },
      {
        targetVersion: current + 1,
        migrate: (record) => {
          const data: Record<string, StorageValue> = { ...record };
          delete data.schemaVersion;
          const migrated = migration.migrate(data);
          if (typeof migrated !== 'object' || migrated === null || Array.isArray(migrated)) {
            throw new Error('module migration must return a record');
          }
          return { ...(migrated as Record<string, StorageValue>), schemaVersion: current + 1 };
        },
        // The module contract has no separate validator; migrateRecord's
        // target-version check is the invariant the executor can enforce.
        validate: (record) => record,
      },
    );
    if (!result.ok) {
      console.error(STORAGE_MIGRATION_FAILED, moduleId);
      return { status: 'failed', from: version, to: target, code: STORAGE_MIGRATION_FAILED };
    }
    const data: Record<string, StorageValue> = { ...result.record };
    delete data.schemaVersion;
    snapshot = data;
    current += 1;
  }

  if (current !== target) {
    // A gap in the declared chain: refuse to guess and keep the old data.
    console.error(STORAGE_MIGRATION_FAILED, moduleId);
    return { status: 'failed', from: version, to: target, code: STORAGE_MIGRATION_FAILED };
  }

  const next: Record<string, StorageValue> = { [versionKey]: target };
  for (const [key, value] of Object.entries(snapshot)) {
    next[`${prefix}${key}`] = value;
  }
  const removed = Object.keys(namespace)
    .map((key) => `${prefix}${key}`)
    .filter((key) => !(key in next));
  if (removed.length > 0) {
    await options.guard.remove(options.area, removed);
  }
  await options.guard.write(options.area, next);
  return { status: 'migrated', from: version, to: target };
}

function readStoredVersion(value: StorageValue | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
