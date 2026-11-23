import { Suspense, type ComponentType, type ReactElement } from 'react';
import { useI18n } from '../i18n/use-i18n';
import { ModuleErrorBoundary } from './ModuleErrorBoundary';

export interface ModuleSurfaceProps {
  readonly moduleId: string;
  readonly Surface: ComponentType | null;
  /**
   * True when the module's UI chunk exists but failed to load; renders a
   * distinct recoverable message instead of the unknown-module copy.
   */
  readonly loadFailed?: boolean;
  /**
   * Versioned input handed off from a selection action (spec §8.2 A3). The
   * core never inspects it; surfaces that accept the prop consume it, all
   * others ignore it.
   */
  readonly initialInput?: unknown;
}

export function ModuleSurface(props: ModuleSurfaceProps): ReactElement {
  const { t } = useI18n();
  if (!props.Surface) {
    return (
      <p role="status">
        {props.loadFailed ? t('module.loadFailed') : t('workbench.unknownModule')}
      </p>
    );
  }
  // The optional initial-input contract widens the bare surface type at this
  // single controlled point; surfaces without the prop never read it.
  const Surface = props.Surface as ComponentType<{ initialInput?: unknown }>;
  return (
    <ModuleErrorBoundary key={props.moduleId} moduleId={props.moduleId} title={t('module.failed')} retryLabel={t('module.retry')}>
      <Suspense fallback={<p role="status">{t('common.loading')}</p>}>
        <Surface initialInput={props.initialInput} />
      </Suspense>
    </ModuleErrorBoundary>
  );
}
