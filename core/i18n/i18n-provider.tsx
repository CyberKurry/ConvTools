import { createContext, useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { chineseMessages, englishMessages, lookup, resolveLocale, type LocalePreference, type Messages } from './types';

export interface I18nContextValue {
  readonly locale: 'en' | 'zh_CN';
  readonly t: (key: string) => string;
}

export const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  t: (key) => key,
});

export function I18nProvider(props: { locale: LocalePreference; children: ReactNode }): ReactElement {
  const locale = resolveLocale(props.locale);
  const messages: Messages = locale === 'zh_CN' ? chineseMessages : englishMessages;
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      t: (key: string) => lookup(messages, key),
    }),
    [locale, messages],
  );
  useEffect(() => {
    document.documentElement.lang = locale === 'zh_CN' ? 'zh-CN' : 'en';
  }, [locale]);
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}