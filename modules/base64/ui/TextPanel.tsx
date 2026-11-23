import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ModuleContext } from '../../../core/module-sdk/context';
import { Button } from '../../../core/ui/Button';
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconSwap,
  IconTrash,
  IconZap,
} from '../../../core/ui/icons';
import { decodeBase64, encodeBase64 } from '../core/encode';
import { exceedsInputLimit } from '../core/limits';
import { DECODE_ERROR_KEYS } from '../core/error-keys';
import type { Base64Format } from '../core/types';
import { recordTextHistory } from '../history';
import styles from './Base64Surface.module.css';

export interface TextPanelProps {
  readonly context: ModuleContext;
  readonly compact?: boolean;
}

export function TextPanel(props: TextPanelProps): ReactElement {
  const t = (key: string, params?: Record<string, string | number>): string => props.context.i18n.t(key, params);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [format, setFormat] = useState<Base64Format>('standard');
  const [strict, setStrict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<readonly string[]>([]);
  const [binaryNotice, setBinaryNotice] = useState(false);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const mountedRef = useRef(true);
  // Bumped on every run and on Clear/Swap so a slow history write from an
  // earlier run cannot paint its failure onto a newer state.
  const runIdRef = useRef(0);

  const resultId = 'base64-text-output';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function resetDiagnostics(): void {
    setError(null);
    setCorrections([]);
    setBinaryNotice(false);
    setCopyHint(null);
  }

  async function run(action: 'encode' | 'decode'): Promise<void> {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    resetDiagnostics();
    setCopied(false);
    // The synchronous encoder copies the whole string on the main thread, so
    // the module-wide 50 MB ceiling applies to text too (spec §11.1/§11.2).
    if (exceedsInputLimit(input)) {
      setOutput('');
      setError(t('tooLarge'));
      return;
    }
    // An empty conversion carries no information worth persisting.
    const shouldRecord = input.length > 0;
    const historyFailed = (): void => {
      if (mountedRef.current && runId === runIdRef.current) {
        setCopyHint(t('historySaveFailed'));
      }
    };
    if (action === 'encode') {
      const encoded = encodeBase64(input, { format });
      setOutput(encoded);
      if (shouldRecord) {
        try {
          await recordTextHistory(props.context.history, {
            action,
            input,
            output: encoded,
            format,
            corrections: [],
          });
        } catch {
          historyFailed();
        }
      }
      return;
    }
    const decoded = decodeBase64(input, strict ? 'strict' : 'tolerant');
    if (!decoded.ok) {
      setError(t(DECODE_ERROR_KEYS[decoded.code]));
      setOutput('');
      return;
    }
    if (decoded.text === null) {
      // Binary payload: surface the .bin guidance instead of a silently empty
      // output (spec §11.2).
      setOutput('');
      setBinaryNotice(true);
      return;
    }
    setOutput(decoded.text);
    setCorrections(decoded.corrections.map((item) => item.detail));
    if (shouldRecord) {
      try {
        await recordTextHistory(props.context.history, {
          action,
          input,
          output: decoded.text,
          format: decoded.format,
          corrections: decoded.corrections.map((item) => item.code),
        });
      } catch {
        historyFailed();
      }
    }
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setCopyHint(null);
    } catch {
      const node = document.getElementById(resultId);
      if (node instanceof HTMLTextAreaElement) {
        node.focus();
        node.select();
      }
      setCopyHint(t('copyFallback'));
    }
  }

  function downloadText(): void {
    const blob = new Blob([output], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'base64.txt';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <section className={styles.panel}>
      {/* Input Card */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <label htmlFor="base64-text-input" className={styles.cardTitle}>
            {t('input')}
          </label>
          <div className={styles.stats}>
            <span>{t('chars', { count: input.length })}</span>
          </div>
        </div>
        <textarea
          id="base64-text-input"
          className={styles.textarea}
          aria-label={t('input')}
          value={input}
          placeholder={t('inputPlaceholder')}
          onChange={(event) => setInput(event.target.value)}
        />
      </div>

      {/* Settings Row */}
      <div className={styles.settingsRow}>
        <label className={styles.formatLabel}>
          <span className={styles.formatLabelText}>{t('format')}</span>
          <select
            className={styles.select}
            aria-label={t('format')}
            value={format}
            onChange={(event) => setFormat(event.target.value as Base64Format)}
          >
            <option value="standard">{t('formatStandard')}</option>
            <option value="url">{t('formatUrl')}</option>
            <option value="data-url">{t('formatDataUrl')}</option>
          </select>
        </label>

        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={strict}
            onChange={(event) => setStrict(event.target.checked)}
          />
          <span className={styles.checkboxText}>{t('strict')}</span>
        </label>
      </div>

      {/* Action Toolbar */}
      <div className={styles.actions}>
        <div className={styles.primaryActions}>
          <Button
            size="sm"
            variant="primary"
            icon={<IconZap size={13} />}
            onClick={() => void run('encode')}
          >
            {t('encode')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<IconZap size={13} />}
            onClick={() => void run('decode')}
          >
            {t('decode')}
          </Button>
        </div>

        <div className={styles.secondaryActions}>
          <Button
            size="sm"
            variant="secondary"
            icon={<IconSwap size={13} />}
            onClick={() => {
              setInput(output);
              setOutput(input);
              // Swapped content invalidates the previous run's diagnostics
              // and any in-flight run's late state updates.
              runIdRef.current += 1;
              resetDiagnostics();
              setCopied(false);
            }}
          >
            {t('swap')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<IconTrash size={13} />}
            onClick={() => {
              setInput('');
              setOutput('');
              // Clearing must also cancel the UI claim of any in-flight run.
              runIdRef.current += 1;
              resetDiagnostics();
              setCopied(false);
            }}
          >
            {t('clear')}
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error ? (
        <div className={styles.errorAlert} role="alert">
          <IconAlertTriangle size={14} className={styles.errorIcon} />
          <p className={styles.errorText}>{error}</p>
        </div>
      ) : null}

      {/* Binary Output Notice */}
      {binaryNotice ? (
        <div className={styles.noticeBanner}>
          <p className={styles.noticeText}>{t('binaryPreview')}</p>
        </div>
      ) : null}

      {/* Corrections Banner */}
      {corrections.length > 0 ? (
        <div className={styles.correctionsBanner}>
          <span className={styles.correctionsTitle}>{t('corrections')}:</span>
          <span className={styles.correctionsList}>{corrections.map((key) => t(key)).join(' · ')}</span>
        </div>
      ) : null}

      {/* Output Card */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <label htmlFor={resultId} className={styles.cardTitle}>
            {t('output')}
          </label>
          <div className={styles.outputToolbar}>
            <Button
              size="sm"
              variant={copied ? 'subtle' : 'secondary'}
              icon={copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
              onClick={() => void copy()}
            >
              {copied ? t('copied') : t('copy')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<IconDownload size={13} />}
              onClick={downloadText}
            >
              {t('download')}
            </Button>
          </div>
        </div>
        <textarea
          id={resultId}
          className={[styles.textarea, styles.textareaOutput].join(' ')}
          aria-label={t('output')}
          value={output}
          placeholder={t('outputPlaceholder')}
          readOnly
        />
      </div>

      {copyHint ? <p className={styles.copyHint} role="status">{copyHint}</p> : null}

      {props.compact ? (
        <a href="/workbench.html#base64" target="_blank" rel="noreferrer" className={styles.openWorkbenchLink}>
          <IconExternalLink size={12} />
          <span>{t('openFileTools')}</span>
        </a>
      ) : null}
    </section>
  );
}
