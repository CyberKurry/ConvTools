import { createHistoryService, type HistoryService } from './history-service';
import { createNamespacedHistory } from './namespaced-history';
import type { ModuleHistoryInput } from './record';
import type { HistoryRecord } from './types';
import type { NamespacedHistory } from '../module-sdk/context';
import type { StorageArea } from '../storage/browser-storage';

/**
 * Records selection-overlay actions in module history (spec §12.3). This runs
 * in the background, which has no kernel instance, so the toggle is read from
 * storage.local on every action: a settings change takes effect immediately,
 * including in a split-incognito background that must never persist.
 */
export interface SelectionHistoryHost {
  readonly incognito: boolean;
  readonly local: Pick<StorageArea, 'get'>;
}

export interface SelectionHistoryRecorder {
  append(moduleId: string, input: ModuleHistoryInput): Promise<void>;
  list(moduleId: string): Promise<readonly HistoryRecord[]>;
  clear(moduleId: string): Promise<void>;
  /** Namespaced view handed to a selection action's context. */
  forModule(moduleId: string): NamespacedHistory;
}

export function createSelectionHistoryRecorder(host: SelectionHistoryHost): SelectionHistoryRecorder {
  const service: HistoryService = createHistoryService({
    enabled: true,
    incognito: host.incognito,
  });

  async function isEnabled(): Promise<boolean> {
    try {
      const stored = await host.local.get(['historyEnabled']);
      return stored.historyEnabled === true;
    } catch {
      return false;
    }
  }

  // The toggle gates appends only; list/clear pass straight through so the
  // action surface matches the kernel's namespaced history view exactly.
  const gated: HistoryService = {
    ...service,
    append: async (record) => {
      if (!(await isEnabled())) {
        return;
      }
      await service.append(record);
    },
  };

  const perModule = new Map<string, NamespacedHistory>();
  function namespace(moduleId: string): NamespacedHistory {
    let view = perModule.get(moduleId);
    if (!view) {
      view = createNamespacedHistory(gated, moduleId);
      perModule.set(moduleId, view);
    }
    return view;
  }

  return {
    append: (moduleId, input) => namespace(moduleId).append(input),
    // Listing and clearing are not gated by the toggle (spec §14: the
    // records are already local; the switch only controls new writes).
    list: (moduleId) => service.list(moduleId),
    clear: (moduleId) => service.clear(moduleId),
    forModule: namespace,
  };
}
