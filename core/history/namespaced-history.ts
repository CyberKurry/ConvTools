import type { NamespacedHistory } from '../module-sdk/context';
import type { ModuleHistoryInput } from './record';
import { appendHistorySafely, type HistoryService } from './history-service';
import { createModuleHistoryRecord } from './record';

/**
 * One assembly for a module's namespaced history view (kernel contexts and
 * selection-action contexts): every append is timestamped and best-effort
 * (spec §15: a history failure never breaks a conversion), and list/clear stay
 * scoped to the module's records.
 */
export function createNamespacedHistory(
  service: Pick<HistoryService, 'append' | 'list' | 'clear'>,
  moduleId: string,
): NamespacedHistory {
  return {
    append: (record: ModuleHistoryInput) =>
      appendHistorySafely(service, createModuleHistoryRecord(record, moduleId, Date.now())),
    list: () => service.list(moduleId),
    clear: () => service.clear(moduleId),
  };
}
