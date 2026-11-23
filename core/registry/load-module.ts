import semver from 'semver';
import { ModuleContractError, ModuleErrorCode } from '../module-sdk/errors';
import { CORE_API_VERSION } from '../module-sdk/manifest';
import type { ToolModuleDefinition } from '../module-sdk/runtime';

export type ModuleLoaderMap = Record<string, () => Promise<{ default: ToolModuleDefinition }>>;

export interface ModuleLoader {
  load(id: string): Promise<ToolModuleDefinition>;
}

export function createModuleLoader(options: { loaders: ModuleLoaderMap }): ModuleLoader {
  const cache = new Map<string, Promise<ToolModuleDefinition>>();

  return {
    load(id: string): Promise<ToolModuleDefinition> {
      const cached = cache.get(id);
      if (cached) {
        return cached;
      }
      const factory = options.loaders[id];
      if (!factory) {
        const failed = Promise.reject(
          new ModuleContractError(ModuleErrorCode.INVALID_ID, '/id', `unknown module "${id}"`),
        );
        cache.set(id, failed);
        return failed;
      }
      const pending = factory()
        .then((mod) => {
          const definition = mod.default;
          if (definition.id !== id) {
            throw new ModuleContractError(
              ModuleErrorCode.ID_MISMATCH,
              '/id',
              `Runtime id "${definition.id}" must match catalog id "${id}"`,
            );
          }
          const parsedRange = semver.validRange(definition.coreApiRange);
          if (parsedRange === null || !semver.satisfies(CORE_API_VERSION, parsedRange)) {
            throw new ModuleContractError(
              ModuleErrorCode.INCOMPATIBLE_CORE_API,
              '/coreApiRange',
              `coreApiRange ${definition.coreApiRange} does not admit Core API ${CORE_API_VERSION}`,
            );
          }
          return definition;
        })
        .catch((error: unknown) => {
          cache.delete(id);
          throw error;
        });
      cache.set(id, pending);
      return pending;
    },
  };
}