import { useMemo, useState, type ComponentType, type ReactElement } from 'react';
import { useI18n } from '../../core/i18n/use-i18n';
import { ModuleBadge } from '../../core/ui/ModuleIcon';
import { ModuleSurface } from '../../core/ui/ModuleSurface';
import {
  IconBox,
  IconClose,
  IconSearch,
  IconZap,
} from '../../core/ui/icons';
import type { HistoryRecord } from '../../core/history/types';
import { HistoryPanel } from './HistoryPanel';
import styles from './WorkbenchApp.module.css';

export interface WorkbenchModule {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly surface: ComponentType | null;
  readonly loadFailed?: boolean;
}

export interface WorkbenchAppProps {
  readonly modules: readonly WorkbenchModule[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  /** Present when the shell wires the per-module history view (spec §9.2). */
  readonly onListHistory?: (id: string) => Promise<readonly HistoryRecord[]>;
  readonly onClearHistory?: (id: string) => Promise<void>;
  /** Input handed off from a selection action, routed to its module. */
  readonly inputHandoff?: { readonly moduleId: string; readonly input: unknown } | null;
}

export function WorkbenchApp(props: WorkbenchAppProps): ReactElement {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [leftHandoffTarget, setLeftHandoffTarget] = useState(false);
  const enabled = props.modules.filter((module) => module.enabled);
  // Memoized on the raw list (a new array every render from the caller), so
  // the search filter is not recomputed on unrelated state changes.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return props.modules.filter((module) => module.enabled);
    }
    return props.modules
      .filter((module) => module.enabled)
      .filter((module) => module.name.toLowerCase().includes(needle) || module.id.includes(needle));
  }, [props.modules, query]);
  const selected = enabled.find((module) => module.id === props.selectedId) ?? null;
  // Opening the workbench without a hash (e.g. from the popup link) shows the
  // first enabled module instead of a misleading "unknown module" card; only
  // an explicit but unknown hash gets the fallback.
  const effectiveSelected = selected ?? (props.selectedId === null ? (enabled[0] ?? null) : null);
  function selectModule(id: string): void {
    if (effectiveSelected?.id === props.inputHandoff?.moduleId && id !== props.inputHandoff?.moduleId) {
      setLeftHandoffTarget(true);
    }
    props.onSelect(id);
  }

  const initialInput =
    effectiveSelected && !leftHandoffTarget && props.inputHandoff?.moduleId === effectiveSelected.id
      ? props.inputHandoff.input
      : undefined;

  return (
    <div className={styles.root}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <IconZap size={14} />
          </div>
          <div>
            <span className={styles.brandName}>{t('app.name')}</span>
            <h1 className={styles.title}>{t('workbench.title')}</h1>
          </div>
        </div>

        {/* Search */}
        <div className={styles.searchWrapper}>
          <label className={styles.searchLabel}>
            <span className={styles.searchLabelText}>{t('workbench.search')}</span>
            <div className={styles.searchControl}>
              <IconSearch size={14} className={styles.searchIcon} />
              <input
                className={styles.searchInput}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('workbench.search')}
                aria-label={t('workbench.search')}
              />
              {query ? (
                <button
                  type="button"
                  className={styles.searchClear}
                  onClick={() => setQuery('')}
                  aria-label={t('workbench.clearSearch')}
                >
                  <IconClose size={12} />
                </button>
              ) : null}
            </div>
          </label>
        </div>

        {/* Module Nav */}
        <nav className={styles.nav}>
          <div className={styles.navHeader}>
            <span>{t('options.modules')}</span>
            <span className={styles.countBadge}>{visible.length}</span>
          </div>
          <div className={styles.navList}>
            {visible.map((module) => {
              // effectiveSelected, not selected: with no hash the first
              // enabled module is rendered, and its nav entry must carry the
              // current marker too.
              const isCurrent = effectiveSelected?.id === module.id;
              return (
                <a
                  key={module.id}
                  href={`#${module.id}`}
                  className={[styles.navItem, isCurrent ? styles.navItemActive : ''].filter(Boolean).join(' ')}
                  aria-current={isCurrent ? 'page' : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    selectModule(module.id);
                  }}
                >
                  <span className={styles.navItemIcon}><ModuleBadge id={module.id} size={15} /></span>
                  <span className={styles.navItemText}>{module.name}</span>
                </a>
              );
            })}
          </div>
        </nav>
      </aside>

      {/* Main Workspace Surface */}
      <main className={styles.main}>
        {effectiveSelected ? (
          <div className={styles.content}>
            <header className={styles.moduleHeader}>
              <div className={styles.moduleHeaderInfo}>
                <div className={styles.moduleHeaderIcon}><ModuleBadge id={effectiveSelected.id} size={15} /></div>
                <div>
                  <h2 className={styles.moduleTitle}>{effectiveSelected.name}</h2>
                  <span className={styles.moduleIdBadge}>{t('workbench.moduleIdLabel')}: {effectiveSelected.id}</span>
                </div>
              </div>
            </header>
            <div className={styles.surfaceContainer}>
              <ModuleSurface
                moduleId={effectiveSelected.id}
                Surface={effectiveSelected.surface}
                {...(effectiveSelected.loadFailed ? { loadFailed: true } : {})}
                initialInput={initialInput}
              />
            </div>
            {props.onListHistory && props.onClearHistory ? (
              <HistoryPanel
                moduleId={effectiveSelected.id}
                moduleName={effectiveSelected.name}
                onList={props.onListHistory}
                onClear={props.onClearHistory}
              />
            ) : null}
          </div>
        ) : (
          <div className={styles.unknownCard}>
            <IconBox size={32} className={styles.unknownIcon} />
            <h2 className={styles.unknownTitle}>
              {enabled.length === 0 ? t('workbench.noModules') : t('workbench.unknownModule')}
            </h2>
            <p className={styles.unknownDesc}>
              {enabled.length === 0 ? t('workbench.noModulesHint') : t('workbench.unknownDesc')}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
