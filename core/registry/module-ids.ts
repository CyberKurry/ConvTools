/**
 * One normalization contract for the stored `enabledModuleIds` and
 * `quickModuleIds` lists (spec §14: storage.sync holds only small JSON
 * settings, unknown module IDs are ignored).
 *
 * Both readers - the settings repository and the background's context-menu
 * refresh - must agree on what a damaged value means: a value that is not an
 * array of strings is treated as corrupt *as a whole* and falls back to the
 * manifest defaults. Filtering such an array item by item would leave the
 * popup showing the defaults while the menus showed nothing.
 */
export function readModuleIdList(
  stored: unknown,
  known: ReadonlySet<string>,
  fallback: readonly string[],
): string[] {
  if (!Array.isArray(stored) || stored.some((item) => typeof item !== 'string')) {
    return [...fallback];
  }
  return normalizeModuleIds(stored as readonly string[], known);
}

/** Keeps known IDs in their stored order, dropping unknown and duplicate entries. */
export function normalizeModuleIds(ids: readonly string[], known: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}
