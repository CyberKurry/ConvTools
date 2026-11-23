import { describe, expect, it, vi } from 'vitest';
import type { ModuleContext } from '../../../core/module-sdk/context';
import type { ToolModuleDefinition } from '../../../core/module-sdk/runtime';
import { ModuleContractError, ModuleErrorCode } from '../../../core/module-sdk/errors';
import { createModuleLoader } from '../../../core/registry/load-module';
import { createLifecycle } from '../../../core/registry/lifecycle';

function definition(overrides: Partial<ToolModuleDefinition> & Pick<ToolModuleDefinition, 'id'>): ToolModuleDefinition {
  return {
    version: '1.0.0',
    coreApiRange: '^1.0.0',
    icon: 'icon.svg',
    surfaces: { popup: null, workbench: null, settings: null, selectionActions: [] },
    permissions: { optionalPermissions: [], optionalHostPermissions: [] },
    ...overrides,
  };
}

function stubContext(moduleId: string, signal: AbortSignal): ModuleContext {
  return {
    moduleId,
    storage: {
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    },
    history: {
      append: () => Promise.resolve(),
      list: () => Promise.resolve([]),
      clear: () => Promise.resolve(),
    },
    i18n: { t: (key) => key, locale: 'en' },
    theme: { scheme: 'light' },
    defaultTimezone: null,
    permissions: { request: () => Promise.resolve(false), contains: () => Promise.resolve(false) },
    network: { request: () => Promise.resolve(undefined) },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    signal,
  };
}

describe('module loader', () => {
  it('rejects a runtime id that does not match the catalog id', async () => {
    const loader = createModuleLoader({
      loaders: {
        'alpha-tool': () => Promise.resolve({ default: definition({ id: 'other-tool' }) }),
      },
    });
    await expect(loader.load('alpha-tool')).rejects.toMatchObject({
      code: ModuleErrorCode.ID_MISMATCH,
    });
  });

  it('rejects an incompatible Core API range at load time', async () => {
    const loader = createModuleLoader({
      loaders: {
        'alpha-tool': () =>
          Promise.resolve({ default: definition({ id: 'alpha-tool', coreApiRange: '^2.0.0' }) }),
      },
    });
    await expect(loader.load('alpha-tool')).rejects.toBeInstanceOf(ModuleContractError);
  });

  it('caches lazy loads so the loader runs once', async () => {
    const inner = vi.fn(() => Promise.resolve({ default: definition({ id: 'alpha-tool' }) }));
    const loader = createModuleLoader({ loaders: { 'alpha-tool': inner } });
    const first = await loader.load('alpha-tool');
    const second = await loader.load('alpha-tool');
    expect(first).toBe(second);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

describe('module lifecycle', () => {
  it('activates a module once and disposes it on disable', async () => {
    const disposer = vi.fn();
    const activate = vi.fn(() => Promise.resolve(disposer));
    const loader = createModuleLoader({
      loaders: {
        'alpha-tool': () => Promise.resolve({ default: definition({ id: 'alpha-tool', activate }) }),
      },
    });
    const lifecycle = createLifecycle({ load: (id) => loader.load(id), createContext: stubContext });
    await lifecycle.enable('alpha-tool');
    await lifecycle.enable('alpha-tool');
    expect(activate).toHaveBeenCalledTimes(1);
    await lifecycle.disable('alpha-tool');
    expect(disposer).toHaveBeenCalledTimes(1);
  });

  it('keeps one module running when another activate throws', async () => {
    const goodActivate = vi.fn(() => Promise.resolve(undefined));
    const loader = createModuleLoader({
      loaders: {
        'good-tool': () => Promise.resolve({ default: definition({ id: 'good-tool', activate: goodActivate }) }),
        'bad-tool': () =>
          Promise.resolve({
            default: definition({
              id: 'bad-tool',
              activate: () => Promise.reject(new Error('boom')),
            }),
          }),
      },
    });
    const lifecycle = createLifecycle({ load: (id) => loader.load(id), createContext: stubContext });
    await lifecycle.enable('good-tool');
    await expect(lifecycle.enable('bad-tool')).rejects.toThrow('boom');
    // Behavioural check in place of the removed isEnabled(): the good module
    // is still active (a second enable is served without re-running
    // activate), while the failed one is not (enabling it tries again).
    await lifecycle.enable('good-tool');
    expect(goodActivate).toHaveBeenCalledTimes(1);
    await expect(lifecycle.enable('bad-tool')).rejects.toThrow('boom');
  });

  it('re-activates after a disable that landed while the first enable was loading (M4)', async () => {
    let releaseLoad: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const disposer = vi.fn();
    const activate = vi.fn(() => Promise.resolve(disposer));
    const loader = createModuleLoader({
      loaders: {
        'alpha-tool': async () => {
          await gate;
          return { default: definition({ id: 'alpha-tool', activate }) };
        },
      },
    });
    const lifecycle = createLifecycle({ load: (id) => loader.load(id), createContext: stubContext });

    const first = lifecycle.enable('alpha-tool');
    // A disable arrives while the load is still in flight; the user then
    // clicks enable again. The second enable must start a fresh activation
    // instead of reusing (and rejecting with) the cancelled promise.
    await lifecycle.disable('alpha-tool');
    const second = lifecycle.enable('alpha-tool');
    releaseLoad?.();

    await expect(first).rejects.toThrow(/enable cancelled/);
    await expect(second).resolves.toMatchObject({ id: 'alpha-tool' });
    // The fresh attempt activated exactly once and is now the active module:
    // disabling it runs the disposer registered by that activation.
    expect(activate).toHaveBeenCalledTimes(1);
    await lifecycle.disable('alpha-tool');
    expect(disposer).toHaveBeenCalledTimes(1);
  });
});
