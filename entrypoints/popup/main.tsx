import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserKernel } from '../../core/kernel-browser';
import { AppProviders } from '../../core/ui/AppProviders';
import { useI18n } from '../../core/i18n/use-i18n';
import { DocumentTitle } from '../../core/ui/DocumentTitle';
import { useKernelSnapshot } from '../../core/use-kernel';
import { PopupApp } from './PopupApp';
import '../../core/theme/tokens.css';

const kernel = createBrowserKernel(browser);

function Popup(): ReactElement | null {
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
      <DocumentTitle page="popup.title" />
      <PopupApp
        modules={state.modules.map((module) => ({
          id: module.id,
          name: module.name,
          enabled: module.enabled,
          Surface: module.definition?.surfaces.popup?.Component ?? null,
          ...(module.loadFailed ? { loadFailed: true } : {}),
        }))}
        quickModuleIds={state.quickModuleIds}
        lastQuickModuleId={state.lastQuickModuleId}
        workbenchHref="/workbench.html"
        optionsHref="/options.html"
        onSelect={(id) => void kernel.selectQuick(id)}
        onAdd={(id) => void kernel.addQuick(id)}
        onRemove={(id) => void kernel.removeQuick(id)}
        onMove={(id, direction) => void kernel.moveQuick(id, direction)}
        onReorder={(id, toIndex) => void kernel.reorderQuick(id, toIndex)}
      />
    </AppProviders>
  );
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

function Loading(): ReactElement {
  const { t } = useI18n();
  return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-muted)' }}>{t('common.loading')}</div>;
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('popup root missing');
}

createRoot(root).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
