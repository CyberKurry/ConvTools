import type { HistoryFileRecord, HistoryRecord, HistoryTextRecord } from './types';

/**
 * What a module may hand to `context.history.append`: its own payload fields
 * only. `moduleId` and `createdAt` are injected by the namespace, and `id` is
 * reserved for IndexedDB.
 */
export type ModuleHistoryInput =
  | Omit<HistoryTextRecord, 'moduleId' | 'id' | 'createdAt'>
  | Omit<HistoryFileRecord, 'moduleId' | 'id' | 'createdAt'>;

/**
 * Builds the stored record from a module-supplied payload. Fields are copied
 * explicitly: a module-supplied `id` could collide with an existing IndexedDB
 * key, and a forged `createdAt` in the past could dodge oldest-first eviction.
 */
export function createModuleHistoryRecord(
  record: ModuleHistoryInput,
  moduleId: string,
  now: number,
): HistoryRecord {
  if (record.kind === 'file') {
    return {
      kind: 'file',
      moduleId,
      action: record.action,
      createdAt: now,
      name: record.name,
      size: record.size,
      mime: record.mime,
      ...(record.sourceUrl !== undefined && { sourceUrl: record.sourceUrl }),
    };
  }
  return {
    kind: 'text',
    moduleId,
    action: record.action,
    createdAt: now,
    input: record.input,
    output: record.output,
    // Conditional spreads keep exactOptionalPropertyTypes happy: an absent
    // module field must stay absent, not explicitly undefined.
    ...(record.format !== undefined && { format: record.format }),
    ...(record.corrections !== undefined && { corrections: record.corrections }),
    ...(record.timeZone !== undefined && { timeZone: record.timeZone }),
  };
}
