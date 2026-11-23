import { type ReactElement, type ReactNode } from 'react';
import { Button } from '../../../core/ui/Button';
import { IconAlertTriangle, IconCheck, IconCopy, IconDownload } from '../../../core/ui/icons';
import type { CardRenderResult } from '../worker/controller';
import styles from './CardSurface.module.css';

export interface PreviewPaneProps {
  /** The live canvas element, owned by the editor surface. */
  readonly preview: ReactNode;
  readonly previewTitle?: string;
  readonly result: CardRenderResult | null;
  /** Translated notice strings; null hides the row. */
  readonly truncatedLabel: string | null;
  readonly noUrlLabel: string | null;
  readonly statusText: string | null;
  /** Visual tone of the status line: failures must not read as success. */
  readonly statusTone?: 'success' | 'error';
  readonly copyLabel: string;
  readonly copiedLabel: string;
  readonly downloadLabel: string;
  readonly sizeCaption: string;
  readonly exportDisabled: boolean;
  readonly onCopy: () => void;
  readonly onDownload: () => void;
}

/** Right-hand pane: live preview, notices, and the two export actions. */
export function PreviewPane(props: PreviewPaneProps): ReactElement {
  const copied = props.statusText !== null && props.statusText === props.copiedLabel;

  return (
    <div className={styles.previewPane}>
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>{props.previewTitle ?? ''}</span>
        </div>
        <div className={styles.previewBody}>
          <div className={styles.canvasWrapper}>
            {props.preview}
          </div>

          {props.truncatedLabel ? (
            <div className={styles.notice} role="status" aria-live="polite">
              <IconAlertTriangle size={12} className={styles.noticeIcon} />
              <span>{props.truncatedLabel}</span>
            </div>
          ) : null}

          {props.noUrlLabel ? (
            <div className={styles.notice} role="status" aria-live="polite">
              <IconAlertTriangle size={12} className={styles.noticeIcon} />
              <span>{props.noUrlLabel}</span>
            </div>
          ) : null}

          <p className={styles.sizeCaption}>{props.sizeCaption}</p>

          <div className={styles.exportRow}>
            <Button
              size="sm"
              variant="primary"
              icon={copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
              disabled={props.exportDisabled}
              onClick={props.onCopy}
            >
              {copied ? props.copiedLabel : props.copyLabel}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<IconDownload size={13} />}
              disabled={props.exportDisabled}
              onClick={props.onDownload}
            >
              {props.downloadLabel}
            </Button>
          </div>

          <p
            className={[
              styles.exportStatus,
              props.statusTone === 'error' ? styles.exportStatusError : '',
            ].filter(Boolean).join(' ')}
            role="status"
            aria-live="polite"
          >
            {props.statusText ?? ''}
          </p>
        </div>
      </div>
    </div>
  );
}
