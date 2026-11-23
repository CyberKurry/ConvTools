import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { HistoryRecord } from '../../core/history/types';
import { useI18n } from '../../core/i18n/use-i18n';
import { truncateByCodePoints } from '../../core/config/text';
import { moduleLocales } from '../../generated/module-manifest';
import { Button } from '../../core/ui/Button';
import { Dialog } from '../../core/ui/Dialog';
import { IconHistory, IconTrash } from '../../core/ui/icons';
import styles from './WorkbenchApp.module.css';

const EXCERPT_CHARS = 80;

export interface HistoryPanelProps {
  readonly moduleId: string;
  readonly moduleName: string;
  readonly onList: (id: string) => Promise<readonly HistoryRecord[]>;
  readonly onClear: (id: string) => Promise<void>;
}

function excerpt(value: string): string {
  return truncateByCodePoints(value.replace(/\s+/g, ' ').trim(), EXCERPT_CHARS);
}

/**
 * History actions are recorded as machine ids ("encode", "generate", ...);
 * modules carry `historyAction.<id>` labels in their own locales, so the
 * panel resolves them through the generated dictionaries and falls back to
 * the raw id only for unknown actions (spec §17: no unlocalized UI text).
 */
function historyActionLabel(moduleId: string, action: string, locale: 'en' | 'zh_CN'): string {
  const dictionary = moduleLocales[moduleId as keyof typeof moduleLocales]?.[locale] as
    | Record<string, string>
    | undefined;
  return dictionary?.[`historyAction.${action}`] ?? action;
}

/**
 * Per-module history view for the workbench (spec §9.2). Records come from
 * the kernel's namespaced history and only ever render metadata plus text
 * excerpts; file contents never enter history (spec §11.3).
 */
export function HistoryPanel(props: HistoryPanelProps): ReactElement {
  const { t, locale } = useI18n();
  // undefined = loading, [] = loaded but empty
  const [records, setRecords] = useState<readonly HistoryRecord[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // Clearing is irreversible, so the button opens a confirmation dialog
  // instead of deleting on the first click (H6).
  const [confirmingClear, setConfirmingClear] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    props
      .onList(props.moduleId)
      .then((list) => {
        if (!cancelled) {
          setError(null);
          setRecords([...list].reverse());
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(t('workbench.historyLoadFailed'));
          setRecords([]);
        }
      });
    return () => {
      cancelled = true;
    };
    // The panel reloads when the module changes; callbacks stay stable at the
    // call sites.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.moduleId]);

  async function refresh(): Promise<void> {
    try {
      const list = await props.onList(props.moduleId);
      if (!mountedRef.current) {
        return;
      }
      setError(null);
      setRecords([...list].reverse());
    } catch {
      if (mountedRef.current) {
        setError(t('workbench.historyLoadFailed'));
      }
    }
  }

  async function clear(): Promise<void> {
    try {
      await props.onClear(props.moduleId);
      await refresh();
    } catch {
      if (mountedRef.current) {
        setError(t('workbench.historyClearFailed'));
      }
    }
  }

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'zh_CN' ? 'zh-CN' : 'en', {
        dateStyle: 'short',
        timeStyle: 'medium',
      }),
    [locale],
  );

  return (
    <section className={styles.historyPanel} aria-label={t('workbench.history')}>
      <div className={styles.historyHeader}>
        <span className={styles.historyTitle}>
          <IconHistory size={13} />
          {t('workbench.history')} · {props.moduleName}
        </span>
        {records !== undefined && records.length > 0 ? (
          <Button size="sm" variant="ghost" icon={<IconTrash size={12} />} onClick={() => setConfirmingClear(true)}>
            {t('options.clearHistory')}
          </Button>
        ) : null}
      </div>
      {records === undefined ? null : records.length === 0 ? (
        <p className={styles.historyEmpty}>{t('workbench.historyEmpty')}</p>
      ) : (
        <ul className={styles.historyList}>
          {records.map((record, index) => (
            <li key={record.id ?? `${record.kind}-${record.createdAt}-${record.action}-${index}`} className={styles.historyItem}>
              <div className={styles.historyMeta}>
                <span className={styles.historyAction}>
                  {historyActionLabel(props.moduleId, record.action, locale)}
                </span>
                <time dateTime={isoTimestamp(record.createdAt)}>
                  {formatTimestamp(formatter, record.createdAt)}
                </time>
              </div>
              {record.kind === 'text' ? (
                <p className={styles.historyLine}>
                  <code>{excerpt(record.input)}</code>
                  <span aria-hidden="true"> → </span>
                  <code>{excerpt(record.output)}</code>
                </p>
              ) : (
                <>
                  <p className={styles.historyLine}>
                    <code>{excerpt(record.name)}</code>
                    <span aria-hidden="true"> · </span>
                    <span>
                      {record.size} B · {record.mime}
                    </span>
                  </p>
                  {record.sourceUrl ? (
                    <p className={styles.historyLine}>
                      <code>{excerpt(record.sourceUrl)}</code>
                    </p>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {error ? <p className={styles.historyEmpty} role="status">{error}</p> : null}
      <Dialog
        open={confirmingClear}
        title={t('options.confirmClearTitle')}
        onClose={() => setConfirmingClear(false)}
      >
        <p className={styles.historyEmpty}>{t('options.confirmClearDesc')}</p>
        <p className={styles.historyAction}>{props.moduleName}</p>
        <div className={styles.confirmActions}>
          <Button size="sm" variant="secondary" onClick={() => setConfirmingClear(false)}>
            {t('options.cancel')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              setConfirmingClear(false);
              void clear();
            }}
          >
            {t('options.confirm')}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

/** A corrupted createdAt must not take the workbench tree down (spec §15). */
function formatTimestamp(formatter: Intl.DateTimeFormat, createdAt: number): string {
  const parsed = new Date(createdAt);
  return Number.isFinite(parsed.getTime()) ? formatter.format(parsed) : '';
}

function isoTimestamp(createdAt: number): string | undefined {
  const parsed = new Date(createdAt);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}
