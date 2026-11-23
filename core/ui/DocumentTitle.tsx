import { useEffect, type ReactElement } from 'react';
import { useI18n } from '../../core/i18n/use-i18n';

/**
 * Keeps document.title localized (spec §17). Render inside AppProviders; the
 * title follows the active locale.
 */
export function DocumentTitle(props: { readonly page: string }): ReactElement | null {
  const { t } = useI18n();
  useEffect(() => {
    document.title = t(props.page);
  }, [props.page, t]);
  return null;
}
