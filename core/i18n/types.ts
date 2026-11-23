import en from '../../locales/en.json';
import zh from '../../locales/zh_CN.json';

export type LocaleId = 'en' | 'zh_CN';
export type LocalePreference = 'auto' | LocaleId;
export type Messages = typeof en;

export const englishMessages: Messages = en;
export const chineseMessages: Messages = zh;

export function collectKeys(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') {
    return [prefix || '/'];
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) => collectKeys(child, `${prefix}/${key}`));
}

export function resolveLocale(preference: LocalePreference, browserLanguage = navigator.language): LocaleId {
  if (preference === 'en' || preference === 'zh_CN') {
    return preference;
  }
  return browserLanguage.toLowerCase().startsWith('zh') ? 'zh_CN' : 'en';
}

export function lookup(messages: Messages, key: string): string {
  const parts = key.split('.');
  let current: unknown = messages;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null || !(part in current)) {
      return key;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : key;
}