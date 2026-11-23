import type { ComponentType } from 'react';
import type { ModuleContext, ModuleI18n, NamespacedStorage } from './context';
import { ModuleContractError, ModuleErrorCode } from './errors';
import type { ToolModuleManifest } from './manifest';

/** A lazily-evaluated React surface, so modules load only on demand. */
export interface LazyModuleSurface {
  readonly Component: ComponentType;
}

/**
 * Page metadata collected for a selection action. Everything is nullable:
 * restricted pages and missing meta tags degrade field by field.
 */
export interface SelectionPageMeta {
  readonly url: string | null;
  readonly title: string | null;
  readonly description: string | null;
  readonly siteName: string | null;
}

/**
 * Background-provided services for selection actions. History is namespaced
 * by the caller: selection actions land in module history when the user
 * enabled it (spec §12.3). Storage, i18n, the signal, and page metadata come
 * from the same core services the kernel exposes on full contexts.
 */
export interface SelectionActionContext {
  readonly history: ModuleContext['history'];
  readonly storage: NamespacedStorage;
  readonly i18n: ModuleI18n;
  readonly defaultTimezone: string | null;
  readonly signal: AbortSignal;
  readonly page: () => Promise<SelectionPageMeta | null>;
}

/** A single selection action the background can invoke from the context menu. */
export interface SelectionActionDefinition {
  readonly id: string;
  readonly label: string;
  /**
   * Executes a short, background-safe transform over the selected text.
   * Returns the transformed result (text, rendered image, or a workbench
   * input hand-off), or throws to trigger a surface error.
   */
  readonly run: (selectedText: string, context: SelectionActionContext) => SelectionActionResult | Promise<SelectionActionResult>;
}

/** A rendered PNG the action produced; surfaces must offer copy and download. */
export interface SelectionImageResult {
  readonly kind: 'image';
  readonly mime: 'image/png';
  readonly dataUrl: string;
  /** Accessibility description for the image; never the raw user input. */
  readonly alt: string;
  readonly fileName: string;
}

/**
 * Asks the core to open the workbench on this module's surface with the
 * module-defined payload. The core never inspects `data`; the module owns
 * its shape and versioning.
 */
export interface SelectionWorkbenchInputResult {
  readonly kind: 'workbench-input';
  readonly data: unknown;
}

export type SelectionActionResult = string | SelectionImageResult | SelectionWorkbenchInputResult;

export function isSelectionImageResult(value: unknown): value is SelectionImageResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<SelectionImageResult>;
  return (
    candidate.kind === 'image' &&
    candidate.mime === 'image/png' &&
    typeof candidate.dataUrl === 'string' &&
    typeof candidate.alt === 'string' &&
    typeof candidate.fileName === 'string'
  );
}

export function isSelectionWorkbenchInputResult(value: unknown): value is SelectionWorkbenchInputResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<SelectionWorkbenchInputResult>;
  // `data` must be present and defined: an undefined payload carries nothing
  // to hand off and can only be a malformed result.
  return candidate.kind === 'workbench-input' && 'data' in candidate && candidate.data !== undefined;
}

export interface ModuleHistoryAdapter {
  toRecord(input: unknown): unknown;
}

export interface ModuleMigration {
  readonly fromVersion: number;
  readonly migrate: (data: unknown) => unknown;
}

export interface ModuleCommandDefinition {
  readonly id: string;
  readonly label: string;
}

/** Runtime definition produced by `defineToolModule`. */
export interface ToolModuleDefinition {
  readonly id: string;
  readonly version: string;
  readonly coreApiRange: string;
  readonly icon: string;
  readonly surfaces: {
    readonly popup: LazyModuleSurface | null;
    readonly workbench: LazyModuleSurface | null;
    readonly settings: LazyModuleSurface | null;
    readonly selectionActions: readonly SelectionActionDefinition[];
  };
  readonly permissions: {
    readonly optionalPermissions: readonly string[];
    readonly optionalHostPermissions: readonly string[];
  };
  readonly history?: ModuleHistoryAdapter;
  readonly migrations?: readonly ModuleMigration[];
  readonly activate?: (context: ModuleContext) => Promise<ModuleDisposer | void>;
}

/** Call `activate()` once; call its disposer when the module is disabled. */
export type ModuleDisposer = () => void | Promise<void>;

export interface DefineToolModuleInput {
  readonly manifest: Readonly<ToolModuleManifest>;
  readonly runtime: Omit<ToolModuleDefinition, 'id' | 'version' | 'coreApiRange' | 'permissions'> & {
    readonly id: string;
  };
}

/**
 * Preserves manifest literals while rejecting a runtime `id` that differs from
 * the file-backed `module.json` id.
 */
export function defineToolModule(input: DefineToolModuleInput): ToolModuleDefinition {
  if (input.runtime.id !== input.manifest.id) {
    throw new ModuleContractError(
      ModuleErrorCode.ID_MISMATCH,
      '/id',
      `Runtime id "${input.runtime.id}" must match module.json id "${input.manifest.id}"`,
    );
  }
  return {
    id: input.manifest.id,
    version: input.manifest.version,
    coreApiRange: input.manifest.coreApiRange,
    icon: input.manifest.icon,
    surfaces: input.runtime.surfaces,
    permissions: input.manifest.permissions,
    ...(input.runtime.history ? { history: input.runtime.history } : {}),
    ...(input.runtime.migrations ? { migrations: input.runtime.migrations } : {}),
    ...(input.runtime.activate ? { activate: input.runtime.activate } : {}),
  };
}
