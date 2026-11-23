export const STORAGE_MIGRATION_FAILED = 'STORAGE_MIGRATION_FAILED';

export interface MigrationOptions<T extends { schemaVersion: number }> {
  readonly targetVersion: number;
  readonly migrate: (record: T) => T;
  readonly validate: (record: T) => T;
}

export type MigrationResult<T> =
  | { readonly ok: true; readonly record: T }
  | { readonly ok: false; readonly code: typeof STORAGE_MIGRATION_FAILED; readonly retained: T };

export function migrateRecord<T extends { schemaVersion: number }>(
  previous: T,
  options: MigrationOptions<T>,
): MigrationResult<T> {
  try {
    const copy = structuredClone(previous);
    const migrated = options.migrate(copy);
    const validated = options.validate(migrated);
    if (validated.schemaVersion !== options.targetVersion) {
      throw new Error('migration did not reach target version');
    }
    return { ok: true, record: validated };
  } catch {
    return { ok: false, code: STORAGE_MIGRATION_FAILED, retained: previous };
  }
}