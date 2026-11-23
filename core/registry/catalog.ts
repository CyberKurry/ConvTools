import type { ToolModuleManifest } from '../module-sdk/manifest';
import { compareCodePoints } from '../config/ordering';

export interface ModuleCatalog {
  readonly modules: readonly ToolModuleManifest[];
  readonly defaultEnabledIds: readonly string[];
  readonly defaultQuickIds: readonly string[];
}

/**
 * Build a catalog from generated metadata only. Default quick modules are
 * ordered by `defaultQuickOrder`, never by a hardcoded ID list.
 */
export function createCatalog(modules: readonly ToolModuleManifest[]): ModuleCatalog {
  const sorted = [...modules].sort((a, b) => compareCodePoints(a.id, b.id));
  const defaultEnabledIds = sorted.filter((module) => module.defaultEnabled).map((module) => module.id);
  const defaultQuickIds = sorted
    .filter((module) => module.defaultEnabled && module.defaultQuickOrder !== null)
    .sort((a, b) => (a.defaultQuickOrder ?? 0) - (b.defaultQuickOrder ?? 0) || compareCodePoints(a.id, b.id))
    .map((module) => module.id);
  return { modules: sorted, defaultEnabledIds, defaultQuickIds };
}
