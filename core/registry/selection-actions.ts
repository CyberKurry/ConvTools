import type { ToolModuleManifest } from '../module-sdk/manifest';

export interface SelectionMenuItem {
  readonly id: string;
  readonly moduleId: string;
  readonly actionId: string;
  readonly title: string;
  readonly contexts: readonly ['selection'];
}

export function selectionMenuId(moduleId: string, actionId: string): string {
  return `convtools:${moduleId}:${actionId}`;
}

export function parseSelectionMenuId(id: string): { moduleId: string; actionId: string } | null {
  const match = /^convtools:([^:]+):([^:]+)$/.exec(id);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { moduleId: match[1], actionId: match[2] };
}

export function listSelectionMenus(
  modules: readonly ToolModuleManifest[],
  enabledIds: ReadonlySet<string>,
  titleFor: (moduleId: string, actionId: string) => string,
): readonly SelectionMenuItem[] {
  return modules
    .filter((module) => enabledIds.has(module.id))
    .flatMap((module) =>
      module.surfaces.selectionActions.map((actionId) => ({
        id: selectionMenuId(module.id, actionId),
        moduleId: module.id,
        actionId,
        title: titleFor(module.id, actionId),
        contexts: ['selection'] as const,
      })),
    );
}