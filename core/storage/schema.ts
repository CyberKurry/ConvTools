export const CURRENT_SCHEMA_VERSION = 1;

export type LocalePreference = 'auto' | 'en' | 'zh_CN';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface SyncSettings {
  readonly locale: LocalePreference;
  readonly theme: ThemePreference;
  readonly enabledModuleIds: readonly string[];
  readonly quickModuleIds: readonly string[];
  readonly lastQuickModuleId: string | null;
  readonly defaultTimezone: string | null;
}

export interface LocalSettings {
  readonly historyEnabled: boolean;
  readonly schemaVersion: number;
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  locale: 'auto',
  theme: 'system',
  enabledModuleIds: [],
  quickModuleIds: [],
  lastQuickModuleId: null,
  defaultTimezone: null,
};

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  historyEnabled: false,
  schemaVersion: CURRENT_SCHEMA_VERSION,
};