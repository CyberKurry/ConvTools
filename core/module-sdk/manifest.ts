/**
 * Data-only module manifest. The build-time scanner reads `module.json` into
 * this shape without ever executing module code.
 */
export interface ToolModuleManifest {
  readonly id: string;
  readonly version: string;
  readonly coreApiRange: string;
  readonly icon: string;
  readonly defaultEnabled: boolean;
  readonly defaultQuickOrder: number | null;
  readonly surfaces: {
    readonly popup: boolean;
    readonly workbench: boolean;
    readonly settings: boolean;
    readonly selectionActions: readonly string[];
  };
  readonly permissions: {
    readonly optionalPermissions: readonly string[];
    readonly optionalHostPermissions: readonly string[];
  };
}

/** The Core API version that bundled modules must declare compatibility with. */
export const CORE_API_VERSION = '1.1.0';

/** Optional host permissions may only target `https://` origins. */
export const ALLOWED_HOST_PROTOCOLS = ['https:'] as const;

/** Kebab-case module identifier (lowercase, letter start, hyphen-separated). */
export const MODULE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Valid selection-action labels are lowercase kebab-ish verbs. */
export const SELECTION_ACTION_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;