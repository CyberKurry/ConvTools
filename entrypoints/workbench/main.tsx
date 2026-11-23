import { StrictMode, useEffect, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserKernel } from '../../core/kernel-browser';
import { AppProviders } from '../../core/ui/AppProviders';
import { useKernelSnapshot } from '../../core/use-kernel';
import { DocumentTitle } from '../../core/ui/DocumentTitle';
import { useI18n } from '../../core/i18n/use-i18n';
import { HandoffEntry } from './HandoffEntry';
import { consumeHandoff } from './handoff-consume';
import { WorkbenchApp } from './WorkbenchApp';
import '../../core/theme/tokens.css';

const kernel = createBrowserKernel(browser);

type Route = { kind: 'handoff'; token: string } | { kind: 'module'; id: string | null };

function parseRoute(hash: string): Route {
  const value = hash.replace(/^#/, '');
  const handoff = /^handoff=([A-Za-z0-9-]+)$/.exec(value);
  if (handoff?.[1]) {
    return { kind: 'handoff', token: handoff[1] };
  }
  return { kind: 'module', id: value || null };
}

function Workbench(): ReactElement | null {
  const { snapshot, error, retry } = useKernelSnapshot(kernel);
  const state = snapshot;
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [inputHandoff, setInputHandoff] = useState<{ moduleId: string; input: unknown } | null>(null);

  // The URL hash is the single source of truth: back/forward, manual edits and
  // the restricted-page fallback tab all stay in sync with the view.
  useEffect(() => {
    const onHashChange = (): void => {
      const next = parseRoute(window.location.hash);
      setRoute(next);
      // A browser back/forward or a manually edited hash can leave the
      // handoff-target module without passing through WorkbenchApp's click
      // handler. Clear the one-time input at that boundary so returning to
      // the module never overwrites edits with the old payload.
      setInputHandoff((current) => {
        if (!current || (next.kind === 'module' && next.id === current.moduleId)) {
          return current;
        }
        return null;
      });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [inputHandoff]);

  if (route.kind === 'handoff') {
    return (
      <AppProviders locale={state?.locale ?? 'auto'} theme={state?.theme ?? 'system'}>
        <DocumentTitle page="workbench.handoffTitle" />
        <HandoffEntry
          token={route.token}
          consume={consumeHandoff}
          onInput={(moduleId, input) => {
            setInputHandoff({ moduleId, input });
            setRoute({ kind: 'module', id: moduleId });
          }}
        />
      </AppProviders>
    );
  }

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
      <DocumentTitle page="workbench.title" />
      <WorkbenchApp
        modules={state.modules.map((module) => ({
          id: module.id,
          name: module.name,
          enabled: module.enabled,
          surface: module.definition?.surfaces.workbench?.Component ?? null,
          ...(module.loadFailed ? { loadFailed: true } : {}),
        }))}
        selectedId={route.id}
        onSelect={(id) => {
          window.location.hash = id;
        }}
        onListHistory={(id) => kernel.listHistory(id)}
        onClearHistory={async (id) => {
          await kernel.clearHistory(id);
        }}
        inputHandoff={inputHandoff}
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
  throw new Error('workbench root missing');
}

createRoot(root).render(
  <StrictMode>
    <Workbench />
  </StrictMode>,
);
