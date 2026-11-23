import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';
import { truncateByCodePoints } from '../../core/config/text';
import { IconCheck, IconClose, IconCopy, IconExternalLink, IconZap } from '../../core/ui/icons';
import styles from './SelectionOverlay.module.css';

const VIEWPORT_MARGIN = 12;
const SELECTION_GAP = 8;
// Matches the CSS min-width min(13rem, …) = 208px so the clamp math and the
// stylesheet agree.
const MIN_OVERLAY_WIDTH = 208;

export interface OverlayLabels {
  readonly copy: string;
  readonly copied: string;
  readonly close: string;
  readonly expand: string;
  readonly manualCopy: string;
  readonly failed: string;
  readonly expandFailed: string;
  readonly truncated: string;
}

// The host page can walk into the open shadow root and dispatch synthetic
// clicks; production builds only act on trusted events. Test builds keep the
// guard off because synthetic (jsdom) input cannot carry the trusted flag.
const requireTrustedInput = import.meta.env.MODE === 'production';

function trustedInput(event: { isTrusted: boolean }): boolean {
  return !requireTrustedInput || event.isTrusted;
}


export interface OverlayInput {
  readonly result: string;
  readonly actionLabel: string;
  readonly isError?: boolean;
  readonly labels: OverlayLabels;
  /** False when the payload has no origin action to re-hand off. */
  readonly canExpand?: boolean;
  readonly onClose: () => void;
  /** Resolves false (or rejects) when the workbench tab could not be opened. */
  readonly onExpand: () => Promise<boolean> | boolean;
}

export function SelectionOverlay(props: OverlayInput): ReactElement {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [expandFailed, setExpandFailed] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  const [offset, setOffset] = useState(() => {
    const selection = window.getSelection();
    const rect =
      selection && selection.rangeCount > 0 && typeof selection.getRangeAt(0).getBoundingClientRect === 'function'
        ? selection.getRangeAt(0).getBoundingClientRect()
        : null;
    if (rect) {
      const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - MIN_OVERLAY_WIDTH - VIEWPORT_MARGIN);
      return {
        top: Math.max(VIEWPORT_MARGIN, rect.bottom + SELECTION_GAP),
        left: Math.min(Math.max(VIEWPORT_MARGIN, rect.left), maxLeft),
      };
    }
    return { top: VIEWPORT_MARGIN, left: VIEWPORT_MARGIN };
  });
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Keep the overlay inside the viewport even when the selection sits near the
  // bottom edge; the real height is only known after the first paint.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const height = dialog.offsetHeight;
    setOffset((current) => ({
      ...current,
      top: Math.min(current.top, Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)),
    }));
  }, []);

  useEffect(() => {
    // Capture phase so a host page stopping event propagation cannot swallow
    // Escape or outside-click dismissal (spec §9.3). Untrusted synthetic
    // events from the host page (it can reach the open shadow root) never
    // drive dismissal; only real user input does.
    const onKey = (event: KeyboardEvent): void => {
      if (!trustedInput(event)) {
        return;
      }
      if (event.key === 'Escape') {
        props.onClose();
      }
    };
    const onPointer = (event: PointerEvent): void => {
      if (!trustedInput(event)) {
        return;
      }
      if (dialogRef.current && !isInsideOverlay(event, dialogRef.current)) {
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onClose]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  async function handleCopy(): Promise<void> {
    if (await copyText(props.result)) {
      setCopied(true);
      setCopyFailed(false);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
      return;
    }
    setCopied(false);
    setCopyFailed(true);
    dialogRef.current?.querySelector('pre')?.scrollIntoView?.();
  }

  function handleExpand(): void {
    setExpandFailed(false);
    const outcome = props.onExpand();
    if (outcome instanceof Promise) {
      void outcome
        .then((ok) => {
          if (!ok) {
            setExpandFailed(true);
          }
        })
        .catch(() => setExpandFailed(true));
    } else if (!outcome) {
      setExpandFailed(true);
    }
  }

  function copyClicked(event: ReactMouseEvent<HTMLButtonElement>): void {
    if (!trustedInput(event)) {
      return;
    }
    void handleCopy();
  }
  function expandClicked(event: ReactMouseEvent<HTMLButtonElement>): void {
    if (!trustedInput(event)) {
      return;
    }
    handleExpand();
  }
  function closeClicked(event: ReactMouseEvent<HTMLButtonElement>): void {
    if (!trustedInput(event)) {
      return;
    }
    props.onClose();
  }

  const isTruncated = props.result.length > 500;
  const previewText = isTruncated ? truncateByCodePoints(props.result, 500) : props.result;
  const failureText = props.isError ? (props.result.trim() !== '' ? props.result : props.labels.failed) : null;

  return (
    <div
      ref={dialogRef}
      className={styles.overlay}
      style={{ top: offset.top, left: offset.left }}
      role="dialog"
      tabIndex={-1}
      aria-label={props.actionLabel}
    >
      <div className={styles.header}>
        <div className={styles.actionBadge}>
          <IconZap size={11} className={styles.actionIcon} />
          <span>{props.actionLabel}</span>
        </div>
        <div className={styles.headerActions}>
          {props.canExpand ? (
            <button type="button" className={[styles.btn, styles.btnExpand].join(' ')} onClick={expandClicked}>
              <IconExternalLink size={11} />
              <span>{props.labels.expand}</span>
            </button>
          ) : null}
          <button
            type="button"
            className={[styles.btn, styles.btnCopy, copied ? styles.btnCopied : ''].filter(Boolean).join(' ')}
            onClick={copyClicked}
          >
            {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
            <span>{copied ? props.labels.copied : props.labels.copy}</span>
          </button>
          <button type="button" className={[styles.btn, styles.btnClose].join(' ')} onClick={closeClicked}>
            <IconClose size={12} />
            <span className={styles.srOnly}>{props.labels.close}</span>
          </button>
        </div>
      </div>
      <div className={styles.body}>
        {props.isError ? (
          <p className={styles.failedText} role="alert">
            {failureText}
          </p>
        ) : (
          // The live region announces the finished conversion for assistive
          // tech, which otherwise only hears the dialog's action label.
          <div aria-live="polite">
            <pre className={styles.codeBlock}>{previewText}</pre>
            {isTruncated ? (
              <p className={styles.manualCopy}>{props.labels.truncated}</p>
            ) : null}
          </div>
        )}
      </div>
      {expandFailed ? (
        <p className={styles.manualCopy} role="alert">
          {props.labels.expandFailed}
        </p>
      ) : null}
      {copyFailed ? (
        <p className={styles.manualCopy} role="status">
          {props.labels.manualCopy}
        </p>
      ) : null}
    </div>
  );
}

function isInsideOverlay(event: PointerEvent, overlay: HTMLElement): boolean {
  const path = event.composedPath();
  if (path.length > 0) {
    return path.includes(overlay);
  }
  return overlay.contains(event.target as Node);
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Continue with the user-gesture-compatible fallback.
    }
  }

  const body = document.body;
  if (!body) {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } finally {
    textarea.remove();
  }
}
