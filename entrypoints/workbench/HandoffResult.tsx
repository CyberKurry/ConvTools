import { useEffect, useRef, useState, type ReactElement } from 'react';
import { truncateByCodePoints } from '../../core/config/text';
import { Button } from '../../core/ui/Button';
import { IconCopy, IconZap } from '../../core/ui/icons';
import { useI18n } from '../../core/i18n/use-i18n';
import styles from './WorkbenchApp.module.css';

export interface HandoffPayloadView {
  readonly result: string;
}

// Large selection results must not blow up the DOM (spec §9.3 truncation rule).
const MAX_HANDOFF_CHARS = 2000;

/**
 * Renders the restricted-page fallback result. The token is consumed exactly
 * once through the injected `consume` callback; the view never writes the
 * result anywhere.
 */
export function HandoffResult(props: {
  readonly token: string;
  readonly consume: (token: string) => Promise<HandoffPayloadView | null>;
}): ReactElement {
  const { t } = useI18n();
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'result'; result: string } | { kind: 'missing' }
  >({ kind: 'loading' });
  const [copyStatus, setCopyStatus] = useState<'copied' | 'failed' | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  // StrictMode double-mounts effects in development and test builds; the
  // consume endpoint is delete-on-read, so only the first attempt may run.
  const consumedTokensRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const effectRunRef = useRef(0);

  useEffect(() => {
    const effectRun = effectRunRef.current + 1;
    effectRunRef.current = effectRun;
    mountedRef.current = true;
    const cleanup = (): void => {
      queueMicrotask(() => {
        if (effectRunRef.current === effectRun) {
          mountedRef.current = false;
        }
      });
    };
    if (consumedTokensRef.current.has(props.token)) {
      return cleanup;
    }
    consumedTokensRef.current.add(props.token);
    props
      .consume(props.token)
      .then((payload) => {
        if (mountedRef.current) {
          setState(payload ? { kind: 'result', result: payload.result } : { kind: 'missing' });
        }
      })
      .catch(() => {
        // A failed consume must not leave the card stuck in "loading".
        if (mountedRef.current) {
          setState({ kind: 'missing' });
        }
      });
    return cleanup;
    // The token identifies this fetch; consume must run exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.token]);

  const truncated =
    state.kind === 'result'
      ? state.result.length > MAX_HANDOFF_CHARS
        ? truncateByCodePoints(state.result, MAX_HANDOFF_CHARS)
        : state.result
      : null;

  return (
    <main className={styles.main}>
      <div className={styles.surfaceContainer}>
        <div className={styles.moduleHeader}>
          <span className={styles.moduleTitle}>
            <IconZap size={14} /> {t('workbench.handoffTitle')}
          </span>
          {state.kind === 'result' ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<IconCopy size={13} />}
              onClick={() => {
                void copyResult(state.result).then((ok) => {
                  setCopyStatus(ok ? 'copied' : 'failed');
                  if (!ok) {
                    resultRef.current?.focus();
                  }
                });
              }}
            >
              {t('workbench.copy')}
            </Button>
          ) : null}
        </div>
        {state.kind === 'loading' ? <p className={styles.unknownDesc}>{t('workbench.handoffLoading')}</p> : null}
        {state.kind === 'missing' ? (
          <div className={styles.unknownCard}>
            <p className={styles.unknownDesc}>{t('workbench.handoffMissing')}</p>
          </div>
        ) : null}
        {state.kind === 'result' ? (
          <>
            <div
              ref={resultRef}
              className={styles.handoffResult}
              role="textbox"
              aria-readonly="true"
              tabIndex={0}
            >
              {truncated}
            </div>
            {state.result.length > MAX_HANDOFF_CHARS ? (
              <p className={styles.unknownDesc} role="status">
                {t('overlay.truncated')}
              </p>
            ) : null}
            {copyStatus === 'copied' ? <p className={styles.unknownDesc} role="status">{t('overlay.copied')}</p> : null}
            {copyStatus === 'failed' ? <p className={styles.unknownDesc} role="status">{t('copy.manual')}</p> : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

async function copyResult(value: string): Promise<boolean> {
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      return false;
    }
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
