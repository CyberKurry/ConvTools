/**
 * The Core Kernel injects this context into every module. Modules must never
 * reach around it for storage, history, permissions, networking, or logging.
 */

import type { ModuleHistoryInput } from '../history/record';

export interface NamespacedStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface NamespacedHistory {
  append(record: ModuleHistoryInput): Promise<void>;
  list(): Promise<readonly unknown[]>;
  clear(): Promise<void>;
}

export interface ModuleLogger {
  debug(code: string, details?: Record<string, unknown>): void;
  info(code: string, details?: Record<string, unknown>): void;
  warn(code: string, details?: Record<string, unknown>): void;
  error(code: string, details?: Record<string, unknown>): void;
}

export interface ModuleI18n {
  t(key: string, params?: Record<string, string | number>): string;
  locale: 'en' | 'zh_CN';
}

export interface ModuleTheme {
  scheme: 'light' | 'dark';
}

export interface PermissionProxy {
  request(permissions: readonly string[], origins?: readonly string[]): Promise<boolean>;
  contains(permissions: readonly string[], origins?: readonly string[]): Promise<boolean>;
}

export interface NetworkBrokerProxy {
  request(intent: unknown): Promise<unknown>;
}

export interface ModuleContext {
  readonly moduleId: string;
  readonly storage: NamespacedStorage;
  readonly history: NamespacedHistory;
  readonly i18n: ModuleI18n;
  readonly theme: ModuleTheme;
  // The synced default timezone from settings (§14); null means "follow the
  // browser zone". Offline modules consume it as an initial value only.
  readonly defaultTimezone: string | null;
  readonly permissions: PermissionProxy;
  readonly network: NetworkBrokerProxy;
  readonly log: ModuleLogger;
  readonly signal: AbortSignal;
}
