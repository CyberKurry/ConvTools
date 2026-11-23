import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserKernel } from '../../core/kernel-browser';
import { AppProviders } from '../../core/ui/AppProviders';
import { useI18n } from '../../core/i18n/use-i18n';
import { DocumentTitle } from '../../core/ui/DocumentTitle';
import { useKernelSnapshot } from '../../core/use-kernel';
import { OptionsApp } from './OptionsApp';
import '../../core/theme/tokens.css';

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function validConfiguredTimeZone(value: string | null): string {
  if (value === null) {
    return browserTimeZone();
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return value;
  } catch {
    return browserTimeZone();
  }
}

const kernel = createBrowserKernel(browser);

function Options(): ReactElement | null {
  const { snapshot, error, retry } = useKernelSnapshot(kernel);
  const state = snapshot;
  if (error) {
    return (
      <AppProviders locale="auto" theme="system">
        <ErrorState onRetry={retry} />
      </AppProviders>
    );
  }
  if (!state) {
    return (
      <AppProviders locale="auto" theme="system">
        <Loading />
      </AppProviders>
    );
  }
  return (
    <AppProviders locale={state.locale} theme={state.theme}>
      <DocumentTitle page="options.title" />
      <OptionsApp
        modules={state.modules.map((module) => ({
          id: module.id,
          name: module.name,
          enabled: module.enabled,
          hasOptionalPermissions:
            (module.definition?.permissions?.optionalPermissions?.length ?? 0) > 0 ||
            (module.definition?.permissions?.optionalHostPermissions?.length ?? 0) > 0,
        }))}
        historyEnabled={state.historyEnabled}
        locale={state.locale}
        theme={state.theme}
        timezone={validConfiguredTimeZone(state.timezone)}
        quickModuleIds={state.quickModuleIds}
        onEnable={(id) => kernel.enableModule(id)}
        onDisable={(id) => kernel.disableModule(id, false)}
        onDisableAndDelete={(id) => kernel.disableModule(id, true)}
        onHistoryEnabled={(enabled) => kernel.setHistoryEnabled(enabled)}
        onLocale={(locale) => kernel.setLocale(locale)}
        onTheme={(theme) => kernel.setTheme(theme)}
        onTimezone={(timezone) => kernel.setTimezone(timezone)}
        onMoveQuick={(id, direction) => kernel.moveQuick(id, direction)}
        onAddQuick={(id) => kernel.addQuick(id)}
        onRemoveQuick={(id) => kernel.removeQuick(id)}
        onRevokePermission={(id) => kernel.revokePermission(id)}
        onClearHistory={(id) => kernel.clearHistory(id)}
        onClearAllHistory={() => kernel.clearHistory(undefined)}
        onListSendPolicies={(id) => kernel.listSendPolicies(id)}
        onClearSendPolicies={(id) => kernel.clearSendPolicies(id)}
      />
    </AppProviders>
  );
}

function Loading(): ReactElement {
  const { t } = useI18n();
  return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-muted)' }}>{t('common.loading')}</div>;
}

function ErrorState({ onRetry }: { onRetry: () => void }): ReactElement {
  const { t } = useI18n();
  return (
    <div role="alert" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-danger)' }}>
      <p>{t('errors.generic')}</p>
      <button type="button" onClick={onRetry}>{t('module.retry')}</button>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('options root missing');
}

createRoot(root).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
