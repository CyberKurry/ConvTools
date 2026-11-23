import type { ModuleContext } from '../module-sdk/context';
import type { ModuleDisposer, ToolModuleDefinition } from '../module-sdk/runtime';

export interface Lifecycle {
  enable(id: string): Promise<ToolModuleDefinition>;
  disable(id: string): Promise<void>;
}

export interface LifecycleOptions {
  load(id: string): Promise<ToolModuleDefinition>;
  createContext(moduleId: string, signal: AbortSignal): ModuleContext;
}

interface ActiveModule {
  readonly definition: ToolModuleDefinition;
  readonly controller: AbortController;
  readonly disposer: ModuleDisposer | undefined;
}

export function createLifecycle(options: LifecycleOptions): Lifecycle {
  const active = new Map<string, ActiveModule>();
  const inflight = new Map<string, Promise<ToolModuleDefinition>>();
  const cancelled = new Set<string>();

  async function enable(id: string): Promise<ToolModuleDefinition> {
    const existing = active.get(id);
    if (existing) {
      return existing.definition;
    }
    const pending = inflight.get(id);
    if (pending && !cancelled.has(id)) {
      return pending;
    }
    if (pending) {
      // A disable landed while this activation was still loading, so the
      // in-flight promise is doomed to reject with "enable cancelled".
      // Reusing it would make the user's next enable click fail silently;
      // wait for it to settle (its own finally clears the slot) and then run
      // a fresh activation below.
      await pending.catch(() => undefined);
    }
    cancelled.delete(id);
    const controller = new AbortController();
    const work = (async () => {
      const definition = await options.load(id);
      if (cancelled.has(id)) {
        controller.abort();
        throw new Error(`module ${id} enable cancelled by disable`);
      }
      const context = options.createContext(id, controller.signal);
      let disposer: ModuleDisposer | undefined;
      if (definition.activate) {
        const result = await definition.activate(context);
        if (typeof result === 'function') {
          disposer = result;
        }
      }
      if (cancelled.has(id)) {
        controller.abort();
        if (disposer) {
          await disposer();
        }
        throw new Error(`module ${id} enable cancelled by disable`);
      }
      active.set(id, { definition, controller, disposer });
      return definition;
    })();
    inflight.set(id, work);
    const clearInflight = (): void => {
      // Only clear our own entry: a superseding enable may already have
      // installed its promise in the same slot.
      if (inflight.get(id) === work) {
        inflight.delete(id);
      }
    };
    work.catch(() => undefined).finally(clearInflight);
    try {
      return await work;
    } finally {
      clearInflight();
    }
  }

  async function disable(id: string): Promise<void> {
    cancelled.add(id);
    const current = active.get(id);
    if (!current) {
      return;
    }
    active.delete(id);
    current.controller.abort();
    if (current.disposer) {
      await current.disposer();
    }
  }

  return { enable, disable };
}