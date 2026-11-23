import type { ReactElement, ReactNode } from 'react';
import { I18nProvider } from '../i18n/i18n-provider';
import type { LocalePreference } from '../i18n/types';
import { ThemeProvider, type ThemePreference } from '../theme/theme-provider';

export interface AppProvidersProps {
  readonly locale: LocalePreference;
  readonly theme: ThemePreference;
  readonly children: ReactNode;
}

export function AppProviders(props: AppProvidersProps): ReactElement {
  return (
    <I18nProvider locale={props.locale}>
      <ThemeProvider theme={props.theme}>{props.children}</ThemeProvider>
    </I18nProvider>
  );
}