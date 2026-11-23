/**
 * Structured error codes for the Module SDK contract boundary. Consumers match
 * on `code` rather than parsing messages, and every error carries the
 * JSON-pointer-style path of the offending field.
 */
export const ModuleErrorCode = {
  INVALID_MANIFEST: 'MODULE_INVALID_MANIFEST',
  INVALID_ID: 'MODULE_INVALID_ID',
  INVALID_VERSION: 'MODULE_INVALID_VERSION',
  INCOMPATIBLE_CORE_API: 'MODULE_INCOMPATIBLE_CORE_API',
  INVALID_ICON: 'MODULE_INVALID_ICON',
  INVALID_SURFACES: 'MODULE_INVALID_SURFACES',
  DUPLICATE_SELECTION_ACTION: 'MODULE_DUPLICATE_SELECTION_ACTION',
  INVALID_PERMISSIONS: 'MODULE_INVALID_PERMISSIONS',
  INVALID_HOST_PERMISSION: 'MODULE_INVALID_HOST_PERMISSION',
  INVALID_QUALIFIER: 'MODULE_INVALID_QUALIFIER',
  MISSING_LOCALE: 'MODULE_MISSING_LOCALE',
  LOCALE_KEY_MISMATCH: 'MODULE_LOCALE_KEY_MISMATCH',
  EMPTY_LOCALE: 'MODULE_EMPTY_LOCALE',
  ID_MISMATCH: 'MODULE_ID_MISMATCH',
  DUPLICATE_ID: 'MODULE_DUPLICATE_ID',
  DIRECTORY_ID_MISMATCH: 'MODULE_DIRECTORY_ID_MISMATCH',
  MISSING_FILE: 'MODULE_MISSING_FILE',
} as const;

export type ModuleErrorCode = (typeof ModuleErrorCode)[keyof typeof ModuleErrorCode];

export class ModuleContractError extends Error {
  readonly code: ModuleErrorCode;
  /** JSON-pointer-style path such as `/surfaces/selectionActions/1`. */
  readonly path: string;

  constructor(code: ModuleErrorCode, path: string, message: string) {
    super(message);
    this.name = 'ModuleContractError';
    this.code = code;
    this.path = path;
  }
}