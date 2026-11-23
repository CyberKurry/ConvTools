import semver from 'semver';
import { ModuleContractError, ModuleErrorCode } from './errors';
import {
  ALLOWED_HOST_PROTOCOLS,
  CORE_API_VERSION,
  MODULE_ID_PATTERN,
  SELECTION_ACTION_PATTERN,
  type ToolModuleManifest,
} from './manifest';

/**
 * Validates a data-only manifest and returns it unchanged. Invalid data is
 * never silently coerced; each violation is reported as a structured
 * {@link ModuleContractError} with a JSON-pointer-style field path.
 */
export function validateManifest(input: unknown): ToolModuleManifest {
  if (typeof input !== 'object' || input === null) {
    throw new ModuleContractError(ModuleErrorCode.INVALID_MANIFEST, '/', 'manifest must be an object');
  }
  const raw = input as Record<string, unknown>;

  const id = requireString(raw.id, '/id');
  if (!MODULE_ID_PATTERN.test(id)) {
    throw new ModuleContractError(ModuleErrorCode.INVALID_ID, '/id', 'id must be kebab-case: ' + id);
  }

  const version = requireString(raw.version, '/version');
  if (semver.valid(version) === null) {
    throw new ModuleContractError(ModuleErrorCode.INVALID_VERSION, '/version', 'version must be valid semver');
  }

  const coreApiRange = requireString(raw.coreApiRange, '/coreApiRange');
  if (!/^\s*(?:\^|>=)\s*\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\s*$/.test(coreApiRange)) {
    throw new ModuleContractError(
      ModuleErrorCode.INCOMPATIBLE_CORE_API,
      '/coreApiRange',
      'coreApiRange must use "^" or ">=" against a valid semver',
    );
  }
  const parsedRange = semver.validRange(coreApiRange);
  if (parsedRange === null || !semver.satisfies(CORE_API_VERSION, parsedRange)) {
    throw new ModuleContractError(
      ModuleErrorCode.INCOMPATIBLE_CORE_API,
      '/coreApiRange',
      `coreApiRange ${coreApiRange} does not admit Core API ${CORE_API_VERSION}`,
    );
  }

  const icon = requireString(raw.icon, '/icon');
  if (!icon.endsWith('.svg') || icon.includes('..') || icon.startsWith('/')) {
    throw new ModuleContractError(ModuleErrorCode.INVALID_ICON, '/icon', 'icon must reference a local .svg asset');
  }

  if (typeof raw.defaultEnabled !== 'boolean') {
    throw new ModuleContractError(ModuleErrorCode.INVALID_MANIFEST, '/defaultEnabled', 'defaultEnabled must be boolean');
  }
  const defaultQuickOrder = raw.defaultQuickOrder;
  if (defaultQuickOrder !== null && typeof defaultQuickOrder !== 'number') {
    throw new ModuleContractError(
      ModuleErrorCode.INVALID_MANIFEST,
      '/defaultQuickOrder',
      'defaultQuickOrder must be number or null',
    );
  }

  const surfaces = raw.surfaces as Record<string, unknown> | undefined;
  if (typeof surfaces !== 'object' || surfaces === null) {
    throw new ModuleContractError(ModuleErrorCode.INVALID_SURFACES, '/surfaces', 'surfaces must be an object');
  }
  const popup = surfaces.popup;
  const workbench = surfaces.workbench;
  const settings = surfaces.settings;
  if (typeof popup !== 'boolean' || typeof workbench !== 'boolean' || typeof settings !== 'boolean') {
    throw new ModuleContractError(
      ModuleErrorCode.INVALID_SURFACES,
      '/surfaces',
      'popup/workbench/settings must be booleans',
    );
  }
  const selectionActions = surfaces.selectionActions;
  if (!Array.isArray(selectionActions)) {
    throw new ModuleContractError(
      ModuleErrorCode.INVALID_SURFACES,
      '/surfaces/selectionActions',
      'selectionActions must be an array',
    );
  }
  const seen = new Set<string>();
  const selectionActionIds: string[] = [];
  selectionActions.forEach((action, index) => {
    if (typeof action !== 'string' || !SELECTION_ACTION_PATTERN.test(action)) {
      throw new ModuleContractError(
        ModuleErrorCode.INVALID_SURFACES,
        `/surfaces/selectionActions/${index}`,
        'selection action must be kebab-case',
      );
    }
    if (seen.has(action)) {
      throw new ModuleContractError(
        ModuleErrorCode.DUPLICATE_SELECTION_ACTION,
        `/surfaces/selectionActions/${index}`,
        `duplicate selection action "${action}"`,
      );
    }
    seen.add(action);
    selectionActionIds.push(action);
  });

  const permissions = raw.permissions as Record<string, unknown> | undefined;
  if (typeof permissions !== 'object' || permissions === null) {
    throw new ModuleContractError(ModuleErrorCode.INVALID_PERMISSIONS, '/permissions', 'permissions must be an object');
  }
  const optionalPermissions = permissions.optionalPermissions;
  const optionalHostPermissions = permissions.optionalHostPermissions;
  if (!Array.isArray(optionalPermissions) || !Array.isArray(optionalHostPermissions)) {
    throw new ModuleContractError(
      ModuleErrorCode.INVALID_PERMISSIONS,
      '/permissions',
      'optionalPermissions and optionalHostPermissions must be arrays',
    );
  }
  const optionalPermissionIds: string[] = [];
  optionalPermissions.forEach((permission, index) => {
    if (typeof permission !== 'string' || permission.length === 0) {
      throw new ModuleContractError(
        ModuleErrorCode.INVALID_PERMISSIONS,
        `/permissions/optionalPermissions/${index}`,
        'optional permission must be a non-empty string',
      );
    }
    optionalPermissionIds.push(permission);
  });
  const optionalHostPermissionIds: string[] = [];
  optionalHostPermissions.forEach((pattern, index) => {
    if (typeof pattern !== 'string') {
      throw new ModuleContractError(
        ModuleErrorCode.INVALID_HOST_PERMISSION,
        `/permissions/optionalHostPermissions/${index}`,
        'host pattern must be a string',
      );
    }
    checkHostPattern(pattern, index);
    optionalHostPermissionIds.push(pattern);
  });

  return {
    id,
    version,
    coreApiRange,
    icon,
    defaultEnabled: raw.defaultEnabled,
    defaultQuickOrder: typeof defaultQuickOrder === 'number' ? defaultQuickOrder : null,
    surfaces: { popup, workbench, settings, selectionActions: selectionActionIds },
    permissions: {
      optionalPermissions: optionalPermissionIds,
      optionalHostPermissions: optionalHostPermissionIds,
    },
  };
}

/**
 * Locale JSON files must declare identical key trees in English and Simplified
 * Chinese. Empty translations are rejected rather than silently skipped.
 */
export function validateLocalePair(en: unknown, zh: unknown): void {
  if (typeof en !== 'object' || en === null) {
    throw new ModuleContractError(ModuleErrorCode.MISSING_LOCALE, '/locales/en.json', 'en.json must be an object');
  }
  if (typeof zh !== 'object' || zh === null) {
    throw new ModuleContractError(ModuleErrorCode.MISSING_LOCALE, '/locales/zh_CN.json', 'zh_CN.json must be an object');
  }
  const enKeys = collectKeys(en, '');
  const zhKeys = collectKeys(zh, '');
  if (enKeys.length === 0) {
    throw new ModuleContractError(ModuleErrorCode.EMPTY_LOCALE, '/locales/en.json', 'en.json must not be empty');
  }
  const enSet = new Set(enKeys);
  const zhSet = new Set(zhKeys);
  for (const key of enSet) {
    if (!zhSet.has(key)) {
      throw new ModuleContractError(
        ModuleErrorCode.LOCALE_KEY_MISMATCH,
        `/locales/zh_CN.json${key}`,
        `missing Chinese translation for ${key}`,
      );
    }
  }
  for (const key of zhSet) {
    if (!enSet.has(key)) {
      throw new ModuleContractError(
        ModuleErrorCode.LOCALE_KEY_MISMATCH,
        `/locales/en.json${key}`,
        `missing English translation for ${key}`,
      );
    }
  }
}

function collectKeys(value: unknown, prefix: string): string[] {
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      throw new ModuleContractError(ModuleErrorCode.EMPTY_LOCALE, prefix, 'translation must not be empty');
    }
    return [prefix];
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ModuleContractError(ModuleErrorCode.MISSING_LOCALE, prefix, 'locale values must be strings or nested objects');
  }
  const keys: string[] = [];
  for (const [name, child] of Object.entries(value)) {
    keys.push(...collectKeys(child, `${prefix}/${name}`));
  }
  return keys;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ModuleContractError(ModuleErrorCode.INVALID_MANIFEST, path, `${path} must be a non-empty string`);
  }
  return value;
}

function checkHostPattern(pattern: string, index: number): void {
  const match = /^https:\/\/([^/*?#]+)\/\*$/i.exec(pattern);
  let valid = match !== null && match[0] === pattern;
  if (valid && match !== null) {
    const authority = match[1] ?? '';
    try {
      const url = new URL(`https://${authority}/`);
      valid =
        url.protocol === 'https:' &&
        url.username.length === 0 &&
        url.password.length === 0 &&
        url.pathname === '/' &&
        url.search.length === 0 &&
        url.hash.length === 0 &&
        url.hostname.length > 0 &&
        !authority.includes('\\');
    } catch {
      valid = false;
    }
  }
  if (!valid || !ALLOWED_HOST_PROTOCOLS.some((protocol) => pattern.toLowerCase().startsWith(`${protocol}//`))) {
    throw new ModuleContractError(
      ModuleErrorCode.INVALID_HOST_PERMISSION,
      `/permissions/optionalHostPermissions/${index}`,
      `host pattern "${pattern}" must target one exact https:// origin`,
    );
  }
}
