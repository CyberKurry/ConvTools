import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useI18n } from '../../core/i18n/use-i18n';
import type { LocalePreference } from '../../core/i18n/types';
import type { ThemePreference } from '../../core/theme/theme-provider';
import type { SendPolicyView } from '../../core/kernel';
import { Button } from '../../core/ui/Button';
import { Dialog } from '../../core/ui/Dialog';
import { ModuleBadge } from '../../core/ui/ModuleIcon';
import {
  IconArrowLeft,
  IconArrowRight,
  IconBox,
  IconClock,
  IconGlobe,
  IconHistory,
  IconMoon,
  IconSettings,
  IconShield,
  IconTrash,
  IconZap,
} from '../../core/ui/icons';
import styles from './OptionsApp.module.css';

export interface OptionsModule {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  /** Modules without optional permission declarations get no revoke control. */
  readonly hasOptionalPermissions?: boolean;
}

export interface OptionsAppProps {
  readonly modules: readonly OptionsModule[];
  readonly historyEnabled: boolean;
  readonly locale: LocalePreference;
  readonly theme: ThemePreference;
  readonly timezone: string;
  readonly quickModuleIds: readonly string[];
  readonly timezones?: readonly string[];
  onEnable(id: string): Promise<void>;
  onDisable(id: string): Promise<void>;
  onDisableAndDelete(id: string): Promise<void>;
  onHistoryEnabled(enabled: boolean): Promise<void>;
  onLocale(locale: LocalePreference): Promise<void>;
  onTheme(theme: ThemePreference): Promise<void>;
  onTimezone(timezone: string): Promise<void>;
  onMoveQuick(id: string, direction: 'left' | 'right'): Promise<void>;
  onAddQuick?(id: string): Promise<void>;
  onRemoveQuick?(id: string): Promise<void>;
  onRevokePermission(id: string): Promise<void>;
  onClearHistory(id: string): Promise<void>;
  onClearAllHistory(): Promise<void>;
  /** Always-allow send-policy management (spec §9.4); absent hides the section. */
  readonly onListSendPolicies?: (id: string) => Promise<readonly SendPolicyView[]>;
  readonly onClearSendPolicies?: (id: string) => Promise<void>;
}

const FALLBACK_ZONES = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Shanghai'];

export function OptionsApp(props: OptionsAppProps): ReactElement {
  const { t } = useI18n();
  const zones = useMemo(() => props.timezones ?? listTimezones(), [props.timezones]);
  const byId = new Map(props.modules.map((module) => [module.id, module]));
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const [policiesCleared, setPoliciesCleared] = useState(false);
  const [policies, setPolicies] = useState<Record<string, readonly SendPolicyView[]>>({});
  const confirmDeleteName = confirmDeleteId !== null ? (byId.get(confirmDeleteId)?.name ?? confirmDeleteId) : '';
  // Clearing history is irreversible, so both the per-module and the global
  // action ask first - the same standard the disable-and-delete dialog uses.
  const [confirmClear, setConfirmClear] = useState<{ kind: 'module'; id: string } | { kind: 'all' } | null>(null);
  const confirmClearName =
    confirmClear?.kind === 'module' ? (byId.get(confirmClear.id)?.name ?? confirmClear.id) : '';
  const addable = props.modules.filter(
    (module) => module.enabled && !props.quickModuleIds.includes(module.id),
  );

  const guarded = (run: () => Promise<void>): (() => void) => {
    return () => {
      // Promise.resolve keeps the guard safe even when a caller returns a
      // plain value; failures surface as visible status text (spec §15)
      // instead of unhandled rejections.
      Promise.resolve()
        .then(run)
        .catch(() => {
          setActionFailed(true);
        });
    };
  };

  // Load the "always allow" policies per module once; the section stays
  // hidden until a networking module actually records a grant.
  useEffect(() => {
    let cancelled = false;
    if (!props.onListSendPolicies) {
      return;
    }
    void (async () => {
      const entries = await Promise.all(
        props.modules.map(async (module) => [module.id, await props.onListSendPolicies?.(module.id)] as const),
      );
      if (!cancelled) {
        setPolicies(Object.fromEntries(entries.filter(([, list]) => list !== undefined)) as Record<string, readonly SendPolicyView[]>);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Module identity is stable within a page; policies load once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const policyModules = Object.entries(policies).filter(([, list]) => list.length > 0);

  async function clearPolicies(moduleId: string): Promise<void> {
    await props.onClearSendPolicies?.(moduleId);
    const list = await props.onListSendPolicies?.(moduleId);
    setPolicies((current) => ({ ...current, [moduleId]: list ?? [] }));
    setPoliciesCleared(true);
    setActionFailed(false);
  }

  return (
    <main className={styles.root}>
      {/* Top Hero Banner */}
      <header className={styles.hero}>
        <div className={styles.heroBrand}>
          <div className={styles.heroIcon}>
            <IconZap size={15} />
          </div>
          <div>
            <span className={styles.heroBadge}>{t('app.name')}</span>
            <h1 className={styles.heroTitle}>{t('options.title')}</h1>
          </div>
        </div>
      </header>

      {/* General Settings */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderIcon}>
            <IconSettings size={14} />
          </div>
          <h2 className={styles.cardTitle}>{t('options.general')}</h2>
        </div>
        <div className={styles.gridFields}>
          <label className={styles.fieldLabel}>
            <span className={styles.labelText}>
              <IconGlobe size={13} className={styles.fieldIcon} />
              {t('options.language')}
            </span>
            <select
              className={styles.select}
              aria-label={t('options.language')}
              value={props.locale}
              onChange={(event) => {
              const value = event.target.value as LocalePreference;
              guarded(() => props.onLocale(value))();
            }}
            >
              <option value="auto">{t('options.languageAuto')}</option>
              <option value="en">{t('options.languageEn')}</option>
              <option value="zh_CN">{t('options.languageZh')}</option>
            </select>
          </label>

          <label className={styles.fieldLabel}>
            <span className={styles.labelText}>
              <IconMoon size={13} className={styles.fieldIcon} />
              {t('options.theme')}
            </span>
            <select
              className={styles.select}
              aria-label={t('options.theme')}
              value={props.theme}
              onChange={(event) => {
              const value = event.target.value as ThemePreference;
              guarded(() => props.onTheme(value))();
            }}
            >
              <option value="system">{t('options.themeSystem')}</option>
              <option value="light">{t('options.themeLight')}</option>
              <option value="dark">{t('options.themeDark')}</option>
            </select>
          </label>

          <label className={styles.fieldLabel}>
            <span className={styles.labelText}>
              <IconClock size={13} className={styles.fieldIcon} />
              {t('options.timezone')}
            </span>
            <select
              className={styles.select}
              aria-label={t('options.timezone')}
              value={props.timezone}
              onChange={(event) => {
              const value = event.target.value;
              guarded(() => props.onTimezone(value))();
            }}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* Module Management */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderIcon}>
            <IconBox size={14} />
          </div>
          <h2 className={styles.cardTitle}>{t('options.modules')}</h2>
        </div>
        <ul className={styles.list}>
          {props.modules.map((module) => (
            <li key={module.id} className={styles.moduleItem}>
              <div className={styles.moduleItemHeader}>
                <div className={styles.moduleItemIcon}>
                  <ModuleBadge id={module.id} size={15} />
                </div>
                <div className={styles.moduleItemInfo}>
                  <span className={styles.moduleName}>{module.name}</span>
                  <span className={[styles.statusBadge, module.enabled ? styles.statusEnabled : styles.statusDisabled].join(' ')}>
                    {module.enabled ? t('options.enabled') : t('options.disabled')}
                  </span>
                </div>
              </div>

              <div className={styles.moduleActions}>
                {module.enabled ? (
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={guarded(() => props.onDisable(module.id))}
                    aria-label={`${t('options.disable')} ${module.name}`}
                  >
                    {t('options.disable')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={guarded(() => props.onEnable(module.id))}
                    aria-label={`${t('options.enable')} ${module.name}`}
                  >
                    {t('options.enable')}
                  </Button>
                )}
                {module.hasOptionalPermissions ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<IconShield size={13} />}
                    onClick={guarded(() => props.onRevokePermission(module.id))}
                    aria-label={`${t('options.revokePermission')} ${module.name}`}
                  >
                    {t('options.revokePermission')}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<IconTrash size={13} />}
                  onClick={() => setConfirmClear({ kind: 'module', id: module.id })}
                  aria-label={`${t('options.clearHistory')} ${module.name}`}
                >
                  {t('options.clearHistory')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setConfirmDeleteId(module.id)}
                  aria-label={`${t('options.disableAndDelete')} ${module.name}`}
                >
                  {t('options.disableAndDelete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Quick Modules Order */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderIcon}>
            <IconZap size={14} />
          </div>
          <h2 className={styles.cardTitle}>{t('options.quickModules')}</h2>
        </div>
        <ol className={styles.quickList}>
          {props.quickModuleIds.map((id, index) => {
            const module = byId.get(id);
            if (!module) {
              return null;
            }
            return (
              <li key={id} className={styles.quickItem}>
                <div className={styles.quickItemInfo}>
                  <span className={styles.quickOrderBadge}>{index + 1}</span>
                  <span className={styles.quickIcon}><ModuleBadge id={id} size={15} /></span>
                  <span className={styles.quickName}>{module.name}</span>
                </div>
                <div className={styles.quickActions}>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<IconArrowLeft size={13} />}
                    onClick={guarded(() => props.onMoveQuick(id, 'left'))}
                    aria-label={`${t('popup.moveLeft')} ${module.name}`}
                  >
                    {t('popup.moveLeft')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<IconArrowRight size={13} />}
                    onClick={guarded(() => props.onMoveQuick(id, 'right'))}
                    aria-label={`${t('popup.moveRight')} ${module.name}`}
                  >
                    {t('popup.moveRight')}
                  </Button>
                  {props.onRemoveQuick ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<IconTrash size={13} />}
                      onClick={guarded(() => (props.onRemoveQuick ? props.onRemoveQuick(id) : Promise.resolve()))}
                      aria-label={`${t('popup.removeModule')} ${module.name}`}
                    >
                      {t('popup.removeModule')}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        {props.onAddQuick ? (
          <div className={styles.quickAddRow}>
            <label className={styles.fieldLabel}>
              <span className={styles.labelText}>{t('popup.addModule')}</span>
              <select
                className={styles.select}
                aria-label={t('popup.addModule')}
                value=""
                onChange={(event) => {
                  const value = event.target.value;
                  if (value) {
                    guarded(() => (props.onAddQuick ? props.onAddQuick(value) : Promise.resolve()))();
                  }
                }}
              >
                <option value="">{t('popup.addModule')}</option>
                {addable.map((module) => (
                  <option key={module.id} value={module.id}>
                    {module.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </section>

      {/* Send Policies (spec §9.4) — rendered only once a grant exists */}
      {props.onClearSendPolicies && policyModules.length > 0 ? (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardHeaderIcon}>
              <IconShield size={14} />
            </div>
            <h2 className={styles.cardTitle}>{t('options.sendPoliciesTitle')}</h2>
          </div>
          <ul className={styles.list}>
            {policyModules.map(([moduleId, list]) => (
              <li key={moduleId} className={styles.moduleItem}>
                <div className={styles.moduleItemInfo}>
                  <span className={styles.moduleName}>{byId.get(moduleId)?.name ?? moduleId}</span>
                </div>
                <ul>
                  {list.map((policy) => (
                    <li key={`${policy.origin}|${policy.dataCategory}`} className={styles.confirmText}>
                      <code>{policy.origin}</code>
                      {' · '}
                      {policy.dataCategory}
                    </li>
                  ))}
                </ul>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    guarded(() => clearPolicies(moduleId))();
                  }}
                >
                  {t('options.clearSendPolicies')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* History & Privacy */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderIcon}>
            <IconHistory size={14} />
          </div>
          <h2 className={styles.cardTitle}>{t('options.history')}</h2>
        </div>
        {actionFailed ? (
          <p className={styles.confirmText} role="alert">
            {t('options.actionFailed')}
          </p>
        ) : null}
        {policiesCleared ? (
          <p className={styles.confirmText} role="status">
            {t('options.sendPoliciesCleared')}
          </p>
        ) : null}
        <div className={styles.historyRow}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={props.historyEnabled}
              onChange={(event) => {
              const checked = event.target.checked;
              guarded(() => props.onHistoryEnabled(checked))();
            }}
            />
            <span className={styles.checkboxText}>{t('options.historyEnabled')}</span>
          </label>
          <Button
            size="sm"
            variant="danger"
            icon={<IconTrash size={13} />}
            onClick={() => setConfirmClear({ kind: 'all' })}
          >
            {t('options.clearAllHistory')}
          </Button>
        </div>
      </section>

      <Dialog
        open={confirmClear !== null}
        title={t('options.confirmClearTitle')}
        onClose={() => setConfirmClear(null)}
      >
        <p className={styles.confirmText}>
          {confirmClear?.kind === 'all' ? t('options.confirmClearAllDesc') : t('options.confirmClearDesc')}
        </p>
        {confirmClear?.kind === 'module' ? <p className={styles.confirmTarget}>{confirmClearName}</p> : null}
        <div className={styles.confirmActions}>
          <Button size="sm" variant="secondary" onClick={() => setConfirmClear(null)}>
            {t('options.cancel')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              const target = confirmClear;
              setConfirmClear(null);
              if (target?.kind === 'module') {
                guarded(() => props.onClearHistory(target.id))();
              } else if (target?.kind === 'all') {
                guarded(() => props.onClearAllHistory())();
              }
            }}
          >
            {t('options.confirm')}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={confirmDeleteId !== null}
        title={t('options.confirmDisableTitle')}
        onClose={() => setConfirmDeleteId(null)}
      >
        <p className={styles.confirmText}>{t('options.confirmDisableDesc')}</p>
        <p className={styles.confirmTarget}>{confirmDeleteName}</p>
        <div className={styles.confirmActions}>
          <Button size="sm" variant="secondary" onClick={() => setConfirmDeleteId(null)}>
            {t('options.cancel')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (confirmDeleteId !== null) {
                guarded(() => props.onDisableAndDelete(confirmDeleteId))();
              }
              setConfirmDeleteId(null);
            }}
          >
            {t('options.confirm')}
          </Button>
        </div>
      </Dialog>
    </main>
  );
}

function listTimezones(): string[] {
  const supported =
    typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl ? Intl.supportedValuesOf('timeZone') : FALLBACK_ZONES;
  return [...new Set(['UTC', ...supported])];
}
