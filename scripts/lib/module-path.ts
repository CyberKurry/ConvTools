import path from 'node:path';
import { MODULE_ID_PATTERN } from '../../core/module-sdk/manifest';

const RESERVED_IDS = new Set(['core', 'generated', 'entrypoints', 'scripts', 'wxt-modules', 'modules']);

export function assertModuleId(id: string): void {
  if (!MODULE_ID_PATTERN.test(id)) {
    throw new Error(`module id "${id}" must be kebab-case`);
  }
  if (RESERVED_IDS.has(id)) {
    throw new Error(`module id "${id}" is reserved`);
  }
}

/**
 * Resolve a candidate module path and require that its parent equals the
 * resolved `modules/` root. Never delete a glob or unresolved user path.
 */
export function resolveModulePath(modulesRoot: string, id: string): string {
  if (id.includes('*') || id.includes('?') || id.includes('[')) {
    throw new Error(`module id "${id}" must be kebab-case, not a glob or path`);
  }
  const resolvedRoot = path.resolve(modulesRoot);
  const candidate = path.resolve(resolvedRoot, id);
  if (path.dirname(candidate) !== resolvedRoot) {
    throw new Error(`module path "${id}" resolves outside ${resolvedRoot}`);
  }
  assertModuleId(path.basename(candidate));
  return candidate;
}
