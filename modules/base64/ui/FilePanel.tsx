import { useEffect, useRef, useState, type DragEvent, type ReactElement } from 'react';
import type { ModuleContext } from '../../../core/module-sdk/context';
import type { Base64Format } from '../core/types';
import { Button } from '../../../core/ui/Button';
import { Progress } from '../../../core/ui/Progress';
import {
  IconAlertTriangle,
  IconCheck,
  IconClose,
  IconCopy,
  IconDownload,
  IconUpload,
} from '../../../core/ui/icons';
import { recordFileHistory } from '../history';
import { createFileController, type FileController } from '../worker/controller';
import { FileTooLargeError } from '../worker/process-file';
import { MAX_FILE_BYTES } from '../worker/protocol';
import styles from './Base64Surface.module.css';

const CORRECTION_KEYS: Record<string, string> = {
  whitespace: 'correctionWhitespace',
  'url-alphabet': 'correctionUrl',
  padding: 'correctionPadding',
};

// Worker failure codes map into the module locale like text-path failures.
const ERROR_KEYS: Record<string, string> = {
  EMPTY: 'errorEmpty',
  INVALID_CHARACTER: 'errorInvalidCharacter',
  INVALID_PADDING: 'errorInvalidPadding',
  INVALID_LENGTH: 'errorInvalidLength',
  INVALID_DATA_URL: 'errorInvalidDataUrl',
  FILE_TOO_LARGE: 'tooLarge',
  INVALID_JOB: 'errorInvalidJob',
  WORKER_TIMEOUT: 'workerTimeout',
};

// Declared-MIME extensions for Data URL decode downloads (spec §11.2: the
// Data URL's own MIME drives the download; no magic-byte guessing). Anything
// unmapped keeps the neutral .bin name.
const MIME_EXTENSIONS: Record<string, string> = {
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'video/mp4': 'mp4',
};

function decodeFileName(mime: string | null): string {
  const extension = (mime !== null ? MIME_EXTENSIONS[mime.toLowerCase()] : undefined) ?? 'bin';
  return `download.${extension}`;
}

export interface FilePanelProps {
  readonly context: ModuleContext;
}

export function FilePanel(props: FilePanelProps): ReactElement {
  const t = (key: string, params?: Record<string, string | number>): string => props.context.i18n.t(key, params);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [corrections, setCorrections] = useState<string[]>([]);
  const [downloadable, setDownloadable] = useState<{
    chunks: ArrayBuffer[];
    mime: string | null;
    kind: 'encode' | 'decode';
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [action, setAction] = useState<'encode' | 'decode'>('encode');
  const [format, setFormat] = useState<Base64Format>('standard');
  const [copied, setCopied] = useState(false);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const controllerRef = useRef<FileController | null>(null);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    // Terminate the worker and release buffers when the surface goes away.
    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
      controllerRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function getController(): FileController {
    if (!controllerRef.current) {
      controllerRef.current = createFileController();
    }
    return controllerRef.current;
  }

  async function handleFile(file: File, kind: 'encode' | 'decode'): Promise<void> {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setError(null);
    setNotice(null);
    setTruncated(false);
    setPreview(null);
    setBinary(false);
    setCorrections([]);
    setDownloadable(null);
    setProgress(null);
    setCopied(false);
    setCopyHint(null);
    if (file.size > MAX_FILE_BYTES) {
      setError(t('tooLarge'));
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      if (!mountedRef.current || runId !== runIdRef.current) {
        return;
      }
      const job = {
        kind,
        buffer,
        format,
        mode: 'tolerant' as const,
        ...(file.type ? { mime: file.type } : {}),
      };
      const result = await getController().run(
        job,
        (event) => {
          if (runId === runIdRef.current) {
            setProgress(Math.round((event.completedBytes / event.totalBytes) * 100));
          }
        },
      );
      if (!mountedRef.current || runId !== runIdRef.current) {
        return;
      }
      setProgress(null);
      setBinary(result.textPreview === null);
      setPreview(result.textPreview);
      setTruncated(result.textPreview !== null && !result.textPreviewComplete);
      setCorrections(result.corrections);
      setDownloadable({ chunks: result.chunks, mime: result.mime, kind });
      try {
        await recordFileHistory(props.context.history, {
          action: kind,
          name: file.name,
          size: file.size,
          mime: file.type || 'application/octet-stream',
        });
      } catch {
        // History is best-effort, but its failure must not land on a newer
        // run: by the time a slow IndexedDB write rejects the user may have
        // started another file, and the stale notice would overwrite the
        // current run's status.
        if (!mountedRef.current || runId !== runIdRef.current) {
          return;
        }
        setNotice(t('historySaveFailed'));
      }
    } catch (caught) {
      if (!mountedRef.current || runId !== runIdRef.current) {
        return;
      }
      setProgress(null);
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        // Cancellation is an expected user action, not a failure (spec §10).
        setNotice(t('cancel'));
        return;
      }
      const code = (caught as { code?: string }).code;
      if (caught instanceof FileTooLargeError || code === 'FILE_TOO_LARGE') {
        setError(t('tooLarge'));
        return;
      }
      const key = typeof code === 'string' ? ERROR_KEYS[code] : undefined;
      setError(key ? t(key) : t('fileReadFailed'));
    }
  }

  function cancel(): void {
    controllerRef.current?.cancel();
  }

  function clearResult(): void {
    // Drops the retained chunk array (up to ~66 MB for a 50 MB file) instead
    // of holding it until the next run or a page unload (spec §16).
    setDownloadable(null);
    setPreview(null);
    setTruncated(false);
    setCorrections([]);
    setBinary(false);
    setNotice(null);
    setCopied(false);
    setCopyHint(null);
  }

  function startDownload(): void {
    if (!downloadable) {
      return;
    }
    const blob = new Blob(downloadable.chunks, { type: downloadable.mime ?? 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    // Encode output is text; decode output uses the Data URL's declared MIME
    // when it maps to a known extension, and .bin otherwise.
    anchor.download = downloadable.kind === 'decode' ? decodeFileName(downloadable.mime) : 'download.txt';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function copyResult(): Promise<void> {
    if (downloadable === null || binary) {
      return;
    }
    // Spec §11.2: the copy action carries the complete result, not the
    // truncated preview — chunks are decoded back to text on the fly.
    try {
      const clipboard = navigator.clipboard;
      if (typeof clipboard?.write !== 'function' || typeof ClipboardItem === 'undefined') {
        setCopied(false);
        setCopyHint(t('copyFallback'));
        return;
      }
      const blob = new Blob(downloadable.chunks, { type: 'text/plain;charset=utf-8' });
      await clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      setCopied(true);
      setCopyHint(null);
    } catch {
      setCopied(false);
      setCopyHint(t('copyFallback'));
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files.length > 1) {
      setNotice(t('onlyOneFile'));
      return;
    }
    const file = event.dataTransfer.files.item(0);
    if (file) {
      void handleFile(file, action);
    }
  }

  function onDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(true);
  }

  function onDragLeave(): void {
    setIsDragging(false);
  }

  return (
    <section className={styles.filePanel}>
      <div className={styles.cardHeader}>
        <h2 className={styles.sectionTitle}>{t('files')}</h2>
        <span className={styles.limitBadge}>{t('fileLimit')}</span>
      </div>

      <div className={styles.actionRow}>
        <div className={styles.segmented} role="group" aria-label={t('files')}>
          <button
            type="button"
            className={[styles.segmentButton, action === 'encode' ? styles.segmentActive : ''].filter(Boolean).join(' ')}
            aria-pressed={action === 'encode'}
            onClick={() => setAction('encode')}
          >
            {t('encode')}
          </button>
          <button
            type="button"
            className={[styles.segmentButton, action === 'decode' ? styles.segmentActive : ''].filter(Boolean).join(' ')}
            aria-pressed={action === 'decode'}
            onClick={() => setAction('decode')}
          >
            {t('decode')}
          </button>
        </div>
        {action === 'encode' ? (
          <label className={styles.formatField}>
            <span className={styles.formatLabel}>{t('format')}</span>
            <select className={styles.select} aria-label={t('format')} value={format} onChange={(event) => setFormat(event.target.value as Base64Format)}>
              <option value="standard">{t('formatStandard')}</option>
              <option value="data-url">{t('formatDataUrl')}</option>
            </select>
          </label>
        ) : null}
      </div>

      <div
        className={[styles.dropzone, isDragging ? styles.dropzoneActive : ''].filter(Boolean).join(' ')}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className={styles.dropzoneContent}>
          <div className={styles.dropzoneIcon}>
            <IconUpload size={20} />
          </div>
          <p className={styles.dropzoneText}>{t('drop')}</p>
          <label className={styles.fileInputLabel}>
            <input
              className={styles.fileInput}
              aria-label={t('chooseFile')}
              type="file"
              onChange={(event) => {
                const file = event.target.files?.item(0);
                // Browsers only fire `change` when the value changes: clearing
                // it lets the user pick the same file again after changing the
                // format or action.
                event.target.value = '';
                if (file) {
                  void handleFile(file, action);
                }
              }}
            />
            <span className={styles.fileInputButton}>{t('chooseFile')}</span>
          </label>
        </div>
      </div>

      {progress !== null ? (
        <div className={styles.progressRow}>
          <Progress value={progress} label={t('progress')} />
          <Button size="sm" variant="ghost" icon={<IconClose size={12} />} onClick={cancel}>
            {t('cancel')}
          </Button>
        </div>
      ) : null}

      {error ? (
        <div className={styles.errorAlert} role="alert">
          <IconAlertTriangle size={14} className={styles.errorIcon} />
          <p className={styles.errorText}>{error}</p>
        </div>
      ) : null}

      {corrections.length > 0 ? (
        <p className={styles.corrections} role="status">
          {t('corrections')}: {corrections.map((code) => t(CORRECTION_KEYS[code] ?? code)).join(' · ')}
        </p>
      ) : null}

      {binary ? (
        <div className={styles.noticeBanner} role="status">
          <p className={styles.noticeText}>{t('binaryPreview')}</p>
        </div>
      ) : null}

      {notice ? (
        <div className={styles.noticeBanner} role="status">
          <p className={styles.noticeText}>{notice}</p>
        </div>
      ) : null}

      {truncated ? (
        <div className={styles.noticeBanner} role="status">
          <p className={styles.noticeText}>{t('previewTruncated')}</p>
        </div>
      ) : null}

      {preview !== null || downloadable ? (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>{t('output')}</span>
            <div className={styles.outputToolbar}>
              {preview !== null ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
                  onClick={() => void copyResult()}
                >
                  {copied ? t('copied') : t('copy')}
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" icon={<IconDownload size={13} />} onClick={startDownload}>
                {t('download')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<IconClose size={13} />}
                onClick={clearResult}
                aria-label={t('clearResult')}
              >
                {t('clearResult')}
              </Button>
            </div>
          </div>
          {preview !== null ? (
            <textarea
              className={[styles.textarea, styles.textareaOutput].join(' ')}
              aria-label={t('output')}
              readOnly
              value={preview}
            />
          ) : null}
          {copyHint ? (
            <p className={styles.copyHint} role="status">
              {copyHint}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
