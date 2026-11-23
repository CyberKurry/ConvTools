import { moduleLocales } from '../../generated/module-manifest';
import { chineseMessages, englishMessages, lookup, resolveLocale, type LocalePreference } from './types';
import type { ModuleI18n } from '../module-sdk/context';

/**
 * The one module-facing translator (kernel contexts and selection-action
 * contexts): the module's own dictionary wins, the extension messages are the
 * fallback, and `{param}` placeholders interpolate from the caller's values.
 *
 * `locale` is read per call so a settings change applies to the next
 * translation without rebuilding the context.
 */
export function createModuleI18n(moduleId: string, getLocale: () => LocalePreference): ModuleI18n {
  return {
    get locale() {
      return resolveLocale(getLocale());
    },
    t(key: string, params?: Record<string, string | number>): string {
      const resolved = resolveLocale(getLocale());
      const moduleDictionary = moduleLocales[moduleId as keyof typeof moduleLocales]?.[resolved] as
        | Record<string, string>
        | undefined;
      const extensionMessages = resolved === 'zh_CN' ? chineseMessages : englishMessages;
      const raw =
        moduleDictionary && typeof moduleDictionary[key] === 'string'
          ? moduleDictionary[key]
          : lookup(extensionMessages, key);
      if (!params) {
        return raw;
      }
      return raw.replaceAll(/\{(\w+)\}/g, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
      );
    },
  };
}
