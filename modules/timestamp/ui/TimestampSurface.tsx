import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ModuleContext } from '../../../core/module-sdk/context';
import { Button } from '../../../core/ui/Button';
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconCopy,
  IconRefresh,
  IconZap,
} from '../../../core/ui/icons';
import { detectUnit } from '../core/detect-unit';
import { describeInstant, parseIntegerTimestamp } from '../core/instant';
import { resolveLocalTime } from '../core/local-time';
import { browserTimeZone, isValidTimeZone } from '../core/timezones';
import type { InstantParts, TimestampUnit } from '../core/types';
import { recordTimestampHistory } from '../history';
import { AmbiguityChoice } from './AmbiguityChoice';
import { TimezonePicker } from './TimezonePicker';
import styles from './TimestampSurface.module.css';

export interface TimestampSurfaceProps {
  readonly context: ModuleContext;
  readonly clock?: { now(): InstanceType<typeof globalThis.Temporal.Instant> };
}

export function TimestampSurface(props: TimestampSurfaceProps): ReactElement {
  const t = (key: string, params?: Record<string, string | number>): string => props.context.i18n.t(key, params);
  const [input, setInput] = useState('');
  const [local, setLocal] = useState('2024-01-15T12:00:00');
  const [unit, setUnit] = useState<'auto' | TimestampUnit>('auto');
  const [zone, setZone] = useState(() => {
    const configured = props.context.defaultTimezone;
    return configured && isValidTimeZone(configured) ? configured : browserTimeZone();
  });
  const [result, setResult] = useState<InstantParts | null>(null);
  // Errors are scoped to the card that produced them so a failed date parse
  // never marks the epoch input invalid for screen readers (and vice versa).
  const [error, setError] = useState<{ epoch: string | null; local: string | null }>({ epoch: null, local: null });
  const [ambiguous, setAmbiguous] = useState<{ earlier: InstantParts; later: InstantParts } | null>(null);
  const [live, setLive] = useState<InstantParts | null>(null);
  const [copiedIso, setCopiedIso] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // Bumped whenever the visible conversion changes so a slow history write
  // from an earlier conversion cannot paint its failure onto newer state.
  const runIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!copiedIso) {
      return;
    }
    const timer = window.setTimeout(() => setCopiedIso(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedIso]);

  useEffect(() => {
    const clock = props.clock ?? {
      now: () => (globalThis as typeof globalThis & { Temporal: TemporalGlobal }).Temporal.Now.instant(),
    };
    const tick = (): void => setLive(describeInstant(clock.now(), zone));
    // Keep hidden extension pages from waking every second. The first visible
    // tick is immediate when the page becomes visible again.
    let id: number | null = null;
    const start = (): void => {
      if (document.hidden || id !== null) {
        return;
      }
      tick();
      id = window.setInterval(tick, 1000);
    };
    const stop = (): void => {
      if (id !== null) {
        window.clearInterval(id);
        id = null;
      }
    };
    start();
    const onVisibility = (): void => {
      stop();
      start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [props.clock, zone]);

  // Any input or zone change invalidates a pending ambiguity choice: picking
  // an offset for a previous local time would silently commit stale data.
  function invalidateResult(): void {
    runIdRef.current += 1;
    setResult(null);
    setError({ epoch: null, local: null });
    setAmbiguous(null);
    setCopiedIso(false);
    setCopyFailed(false);
    setHistoryWarning(null);
  }
  function updateInput(value: string): void {
    setInput(value);
    invalidateResult();
  }
  function updateLocal(value: string): void {
    setLocal(value);
    invalidateResult();
  }
  function updateZone(value: string): void {
    setZone(value);
    invalidateResult();
  }
  function updateUnit(value: 'auto' | TimestampUnit): void {
    setUnit(value);
    invalidateResult();
  }

  function recordHistory(action: string, rawInput: string, isoUtc: string): Promise<void> {
    // History is best-effort: an unexpected storage failure must not turn an
    // already successful conversion into an error (spec §15). The guard keeps
    // a late failure from a previous conversion off the current one.
    const runId = runIdRef.current;
    return recordTimestampHistory(props.context.history, {
      action,
      input: rawInput,
      result: isoUtc,
      timeZone: zone,
    }).catch(() => {
      if (mountedRef.current && runId === runIdRef.current) {
        setHistoryWarning(t('historySaveFailed'));
      }
    });
  }

  async function convertTimestamp(): Promise<void> {
    setError({ epoch: null, local: null });
    setAmbiguous(null);
    setResult(null);
    setHistoryWarning(null);
    try {
      const detected = detectUnit(input.trim());
      const resolved = unit === 'auto' ? detected.unit : unit;
      if (resolved === 'ambiguous') {
        setError({ epoch: t('ambiguousUnit'), local: null });
        return;
      }
      if (resolved === 'invalid') {
        setError({ epoch: t('invalidTimestamp'), local: null });
        return;
      }
      const parts = parseIntegerTimestamp(input.trim(), resolved, zone);
      setResult(parts);
      await recordHistory('timestamp-to-date', input, parts.isoUtc);
    } catch (caught) {
      setResult(null);
      setError({ epoch: caught instanceof RangeError ? t('outOfRange') : t('invalidTimestamp'), local: null });
    }
  }

  async function convertLocal(): Promise<void> {
    setError({ epoch: null, local: null });
    setAmbiguous(null);
    setResult(null);
    setHistoryWarning(null);
    let resolution: ReturnType<typeof resolveLocalTime>;
    try {
      resolution = resolveLocalTime(local, zone);
    } catch {
      setError({ epoch: null, local: t('invalidDate') });
      setResult(null);
      return;
    }
    if (resolution.kind === 'nonexistent') {
      setResult(null);
      setError({ epoch: null, local: t('nonexistentDst') });
      return;
    }
    if (resolution.kind === 'ambiguous') {
      setAmbiguous({ earlier: resolution.earlier, later: resolution.later });
      setResult(null);
      return;
    }
    setResult(resolution.instant);
    await recordHistory('date-to-timestamp', local, resolution.instant.isoUtc);
  }

  async function chooseAmbiguous(choice: InstantParts): Promise<void> {
    setAmbiguous(null);
    setResult(choice);
    setHistoryWarning(null);
    await recordHistory('date-to-timestamp', local, choice.isoUtc);
  }

  async function copyIso(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedIso(true);
      setCopyFailed(false);
    } catch {
      setCopiedIso(false);
      setCopyFailed(true);
    }
  }

  const epochErrorId = 'timestamp-epoch-error';
  const localErrorId = 'timestamp-local-error';
  const epochError = error.epoch;
  const localError = error.local;

  return (
    <div className={styles.root}>
      {/* Live Clock Banner */}
      <div className={styles.liveBanner}>
        <div className={styles.liveHeader}>
          <div className={styles.livePulse}>
            <span className={styles.pulseDot} />
            <span className={styles.liveLabel}>{t('current')}</span>
          </div>
          <Button
            size="sm"
            variant="subtle"
            icon={<IconRefresh size={13} />}
            onClick={() => {
              const clock = props.clock ?? {
                now: () => (globalThis as typeof globalThis & { Temporal: TemporalGlobal }).Temporal.Now.instant(),
              };
              const current = describeInstant(clock.now(), zone);
              setLive(current);
              // Auto chooses milliseconds so the exact sampled instant is not
              // silently rounded to seconds before conversion.
              const selectedUnit = unit === 'seconds' ? 'seconds' : 'milliseconds';
              const value = selectedUnit === 'seconds' ? current.epochSeconds : current.epochMilliseconds;
              if (unit === 'auto') {
                setUnit('milliseconds');
              }
              const parts = parseIntegerTimestamp(String(value), selectedUnit, zone);
              updateInput(String(value));
              setResult(parts);
              // A pinned current instant is a conversion like any other, so it
              // lands in history under the same semantics (spec §12.1/§12.3).
              void recordHistory('timestamp-to-date', String(value), parts.isoUtc);
            }}
          >
            {t('useCurrent')}
          </Button>
        </div>
        <p className={styles.liveValues}>
          {t('current')}: {live ? `${live.epochSeconds}s / ${live.epochMilliseconds}ms` : ''}
        </p>
      </div>

      {/* Timezone Configuration */}
      <div className={styles.timezoneCard}>
        <TimezonePicker
          value={zone}
          browserZone={browserTimeZone()}
          label={t('timezone')}
          searchLabel={t('searchTimezone')}
          onChange={updateZone}
        />
      </div>

      {/* Convert Timestamp to Date */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>{t('timestamp')} → {t('datetime')}</span>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formRow}>
            <label className={styles.inputField}>
              <span className={styles.fieldLabelText}>{t('timestamp')}</span>
              <input
                className={styles.input}
                aria-label={t('timestamp')}
                placeholder={t('inputExample')}
                value={input}
                aria-invalid={epochError !== null}
                aria-describedby={epochError !== null ? epochErrorId : undefined}
                onChange={(event) => updateInput(event.target.value)}
              />
            </label>

            <label className={styles.selectField}>
              <span className={styles.fieldLabelText}>{t('unit')}</span>
              <select
                className={styles.select}
                aria-label={t('unit')}
                value={unit}
                onChange={(event) => updateUnit(event.target.value as 'auto' | TimestampUnit)}
              >
                <option value="auto">{t('auto')}</option>
                <option value="seconds">{t('seconds')}</option>
                <option value="milliseconds">{t('milliseconds')}</option>
              </select>
            </label>
          </div>

          <div className={styles.actionRow}>
            <Button
              size="sm"
              variant="primary"
              icon={<IconZap size={13} />}
              onClick={() => void convertTimestamp()}
            >
              {t('convertToDate')}
            </Button>
          </div>

          {epochError ? (
            <div className={styles.errorAlert} role="alert" id={epochErrorId}>
              <IconAlertTriangle size={14} className={styles.errorIcon} />
              <p className={styles.errorText}>{epochError}</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Convert Date to Timestamp */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>{t('datetime')} → {t('timestamp')}</span>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formRow}>
            <label className={styles.inputField}>
              <span className={styles.fieldLabelText}>{t('datetime')}</span>
              <input
                className={styles.input}
                aria-label={t('datetime')}
                value={local}
                aria-invalid={localError !== null}
                aria-describedby={localError !== null ? localErrorId : undefined}
                onChange={(event) => updateLocal(event.target.value)}
              />
            </label>
          </div>

          <div className={styles.actionRow}>
            <Button
              size="sm"
              variant="primary"
              icon={<IconClock size={13} />}
              onClick={() => void convertLocal()}
            >
              {t('convertToTimestamp')}
            </Button>
          </div>

          {localError ? (
            <div className={styles.errorAlert} role="alert" id={localErrorId}>
              <IconAlertTriangle size={14} className={styles.errorIcon} />
              <p className={styles.errorText}>{localError}</p>
            </div>
          ) : null}
        </div>
      </div>

      {historyWarning ? <p className={styles.copyHint} role="status">{historyWarning}</p> : null}

      {/* DST Ambiguity Choice */}
      {ambiguous ? (
        <div role="status">
          <AmbiguityChoice
            prompt={t('chooseOffset')}
            earlierLabel={t('earlier')}
            laterLabel={t('later')}
            cancelLabel={t('cancel')}
            earlier={ambiguous.earlier}
            later={ambiguous.later}
            onChoose={(choice) => void chooseAmbiguous(choice)}
            onCancel={() => setAmbiguous(null)}
          />
        </div>
      ) : null}

      {/* Conversion Result Output */}
      {result ? (
        <output className={styles.resultCard}>
          <div className={styles.resultHeader}>
            <span className={styles.resultTitle}>{t('resultTitle')}</span>
            <Button
              size="sm"
              variant={copiedIso ? 'subtle' : 'secondary'}
              icon={copiedIso ? <IconCheck size={13} /> : <IconCopy size={13} />}
              onClick={() => void copyIso(result.isoUtc)}
            >
              {copiedIso ? t('copied') : t('copy')}
            </Button>
          </div>
          {copyFailed ? (
            <p role="status" className={styles.copyHint}>
              {t('copyFallback')}
            </p>
          ) : null}
          <div className={styles.resultContent}>
            <div className={styles.resultItem}>
              <span className={styles.resultLabel}>{t('iso')}:</span>
              <code className={styles.resultValue}>{result.isoUtc}</code>
            </div>
            <div className={styles.resultItem}>
              <span className={styles.resultLabel}>{t('zoned')}:</span>
              <code className={styles.resultValue}>{result.zoned}</code>
            </div>
            <div className={styles.resultItem}>
              <span className={styles.resultLabel}>{t('seconds')}:</span>
              <code className={styles.resultValue}>{String(result.epochSeconds)}</code>
              <span className={styles.resultDivider}>/</span>
              <span className={styles.resultLabel}>{t('milliseconds')}:</span>
              <code className={styles.resultValue}>{String(result.epochMilliseconds)}</code>
            </div>
          </div>
        </output>
      ) : null}
    </div>
  );
}
