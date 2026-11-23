import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { ModuleContext, ModuleI18n } from '../../../core/module-sdk/context';
import { IconAlertTriangle } from '../../../core/ui/icons';
import { createCardController, type CardController, type CardRenderResult } from '../worker/controller';
import type { CardSpec } from '../worker/protocol';
import { CARD_SIZES } from '../core/templates';
import {
  hostOf,
  normalizeCardText,
  normalizeUrl,
  parseShareCardInput,
  SITE_NAME_MAX_CHARS,
} from '../core/meta';
import { EXCERPT_MAX_CHARS, SUMMARY_MAX_CHARS, TITLE_MAX_CHARS } from '../core/limits';
import type { SizeId, TemplateId } from '../core/types';
import { appendCardHistory, cardFileName } from '../history';
import { PreviewPane } from './PreviewPane';
import styles from './CardSurface.module.css';

export interface CardSurfaceProps {
  readonly context: ModuleContext;
  readonly initialInput?: unknown;
}

const TEMPLATE_OPTIONS: ReadonlyArray<{ readonly id: TemplateId; readonly labelKey: string; readonly swatch: string }> = [
  { id: 'paper', labelKey: 'templatePaper', swatch: '#ffffff' },
  { id: 'ink', labelKey: 'templateInk', swatch: '#0d1117' },
  { id: 'mist', labelKey: 'templateMist', swatch: '#e2ecf8' },
];

export function CardSurface(props: CardSurfaceProps): ReactElement {
  const t: ModuleI18n['t'] = (key, params) => props.context.i18n.t(key, params);
  const controllerRef = useRef<CardController | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Lazily created: StrictMode's simulated unmount runs the disposer, so a
  // controller built during render would be permanently dead on remount.
  function getController(): CardController {
    if (controllerRef.current === null) {
      controllerRef.current = createCardController();
    }
    return controllerRef.current;
  }

  const initial = useMemo(() => parseShareCardInput(props.initialInput), [props.initialInput]);
  const [excerpt, setExcerpt] = useState(() => initial?.excerpt ?? '');
  const [title, setTitle] = useState(() => initial?.title ?? '');
  const [summary, setSummary] = useState(() => initial?.summary ?? '');
  const [url, setUrl] = useState(() => initial?.url ?? '');
  const [siteName, setSiteName] = useState(() => initial?.siteName ?? '');
  const [template, setTemplate] = useState<TemplateId>('paper');
  const [sizeId, setSizeId] = useState<SizeId>('portrait');
  const [watermark, setWatermark] = useState(true);
  const [result, setResult] = useState<CardRenderResult | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'success' | 'error'>('success');
  // Bumped after an export supersedes the in-flight preview so the preview
  // re-renders instead of staying blank until the next field edit.
  const [previewNonce, setPreviewNonce] = useState(0);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const settingsTouchedRef = useRef(false);
  const renderGenerationRef = useRef(0);
  const statusTimerRef = useRef<number | null>(null);

  // Settings live in the module namespace (incognito overlay applies).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [storedTemplateResult, storedSizeResult, storedWatermarkResult] = await Promise.allSettled([
        props.context.storage.get<string>('template'),
        props.context.storage.get<string>('size'),
        props.context.storage.get<boolean>('watermark'),
      ]);
      if (cancelled) {
        return;
      }
      const storedTemplate = storedTemplateResult.status === 'fulfilled' ? storedTemplateResult.value : undefined;
      const storedSize = storedSizeResult.status === 'fulfilled' ? storedSizeResult.value : undefined;
      const storedWatermark = storedWatermarkResult.status === 'fulfilled' ? storedWatermarkResult.value : undefined;
      if (!settingsTouchedRef.current) {
        if (storedTemplate === 'paper' || storedTemplate === 'ink' || storedTemplate === 'mist') {
          setTemplate(storedTemplate);
        }
        if (storedSize === 'portrait' || storedSize === 'square') {
          setSizeId(storedSize);
        }
        if (typeof storedWatermark === 'boolean') {
          setWatermark(storedWatermark);
        }
      }
      setSettingsLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const normalizedExcerpt = normalizeCardText(excerpt, EXCERPT_MAX_CHARS) ?? '';
  const normalizedTitle = normalizeCardText(title, TITLE_MAX_CHARS);
  const normalizedSummary = normalizeCardText(summary, SUMMARY_MAX_CHARS);
  const trimmedUrl = url.trim();
  const specUrl = normalizeUrl(trimmedUrl);
  const urlValid = trimmedUrl === '' || specUrl !== null;
  const normalizedSiteName = normalizeCardText(siteName, SITE_NAME_MAX_CHARS) ?? hostOf(specUrl);
  const renderFailedLabel = t('renderFailed');

  const buildSpec = (): CardSpec => ({
    excerpt: normalizedExcerpt,
    title: normalizedTitle,
    summary: normalizedSummary,
    url: specUrl,
    siteName: normalizedSiteName,
    templateId: template,
    sizeId,
    dateIso: formatDateIso(),
    locale: props.context.i18n.locale,
    watermarkText: watermark ? t('watermarkText') : '',
    qrHint: watermark ? t('qrHint') : '',
  });

  // Debounced live preview at 1×.
  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }
    const generation = renderGenerationRef.current + 1;
    renderGenerationRef.current = generation;
    const timer = window.setTimeout(() => {
      if (normalizedExcerpt === '') {
        setResult(null);
        setTruncated(false);
        setStatus(null);
        return;
      }
      void getController()
        .run({ card: buildSpec(), scale: 1 })
        .then((rendered) => {
          if (generation !== renderGenerationRef.current) {
            return;
          }
          setResult(rendered);
          setTruncated(rendered.excerptTruncated);
          setStatus(null);
        })
        .catch((caught: unknown) => {
          if (generation !== renderGenerationRef.current) {
            return;
          }
          if (caught instanceof DOMException && caught.name === 'AbortError') {
            // An export superseded this preview; the export re-kicks a fresh
            // render when it settles, so keep the last good canvas instead of
            // wiping it.
            return;
          }
          setResult(null);
          setTruncated(false);
          showStatus(renderFailedLabel, 'error');
        });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      renderGenerationRef.current += 1;
    };
    // Redraw on any content or appearance change; previewNonce re-runs the
    // render after an export cancelled the in-flight one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excerpt, title, summary, url, siteName, template, sizeId, watermark, settingsLoaded, previewNonce]);

  // Real-unmount disposal only. StrictMode's simulated unmount runs this
  // cleanup too; nulling the ref lets the next interaction build a fresh
  // controller instead of talking to a terminated worker.
  useEffect(() => {
    return () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
      if (statusTimerRef.current !== null) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  function showStatus(message: string, tone: 'success' | 'error'): void {
    setStatus(message);
    setStatusTone(tone);
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current);
    }
    if (tone === 'success') {
      // Spec §5.4: the copied confirmation reverts after two seconds.
      statusTimerRef.current = window.setTimeout(() => setStatus(null), 2000);
    } else {
      statusTimerRef.current = null;
    }
  }

  // Decode the finished preview into the canvas; skipped where
  // createImageBitmap is unavailable (unit tests).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    if (!result || typeof createImageBitmap !== 'function') {
      if (!result) {
        canvas.width = 0;
        canvas.height = 0;
      }
      return;
    }
    const blob = new Blob([result.buffer], { type: 'image/png' });
    let cancelled = false;
    void createImageBitmap(blob)
      .then((bitmap) => {
        if (cancelled) {
          bitmap.close();
          return;
        }
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(bitmap, 0, 0);
        bitmap.close();
      })
      .catch(() => {
        if (!cancelled) {
          showStatus(renderFailedLabel, 'error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [renderFailedLabel, result]);

  async function renderPng2x(): Promise<Blob | null> {
    // A user-initiated export must not share the preview's worker slot: the
    // debounced preview render (150 ms after any field edit) would cancel an
    // in-flight export and the download would silently disappear. The export
    // gets its own short-lived controller and disposes it right after.
    const controller = createCardController();
    try {
      const rendered = await controller.run({ card: buildSpec(), scale: 2 });
      return new Blob([rendered.buffer], { type: 'image/png' });
    } finally {
      controller.dispose();
    }
  }

  function recordExport(blob: Blob): void {
    // File metadata only (D4): the QR-encoded url rides along, nothing else.
    void appendCardHistory(props.context.history, {
      template,
      sizeId,
      bytes: blob.size,
      sourceUrl: specUrl,
    });
  }

  function downloadBlob(blob: Blob): void {
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = cardFileName(template, sizeId);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  async function copyImage(): Promise<void> {
    if (normalizedExcerpt === '') {
      return;
    }
    setStatus(null);
    let blob: Blob | null = null;
    try {
      blob = await renderPng2x();
      if (!blob || typeof ClipboardItem !== 'function' || !navigator.clipboard) {
        throw new Error('CLIPBOARD_UNAVAILABLE');
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      recordExport(blob);
      showStatus(t('copied'), 'success');
    } catch {
      try {
        if (blob) {
          downloadBlob(blob);
          recordExport(blob);
          showStatus(t('copyFailedDownloaded'), 'error');
        } else {
          showStatus(t('renderFailed'), 'error');
        }
      } catch {
        showStatus(t('renderFailed'), 'error');
      }
    } finally {
      // The export's run() cancelled the in-flight preview render; re-render
      // so the preview matches the current fields again.
      setPreviewNonce((nonce) => nonce + 1);
    }
  }

  async function downloadImage(): Promise<void> {
    if (normalizedExcerpt === '') {
      return;
    }
    setStatus(null);
    try {
      const blob = await renderPng2x();
      if (blob) {
        downloadBlob(blob);
        recordExport(blob);
      }
    } catch {
      showStatus(t('renderFailed'), 'error');
    } finally {
      setPreviewNonce((nonce) => nonce + 1);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void copyImage();
    }
  }

  const exportDisabled = normalizedExcerpt === '';
  const previewTitle = normalizedTitle ?? '';
  const statusText = status !== null ? status : '';
  const size = CARD_SIZES[sizeId];
  const templateNameKeys: Record<TemplateId, string> = {
    paper: 'templatePaper',
    ink: 'templateInk',
    mist: 'templateMist',
  };

  return (
    <div className={styles.editor} aria-label={t('name')}>
      <div className={styles.columns}>
        <div className={styles.formColumn}>
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>{t('excerpt')}</span>
              <div className={styles.stats}>
                <span>{t('chars', { count: Array.from(excerpt).length })}</span>
              </div>
            </div>
            <div className={styles.cardBody}>
              <div className={styles.inputField}>
                <label className={styles.fieldLabel} htmlFor="share-card-excerpt">
                  {t('excerpt')}
                </label>
                <textarea
                  id="share-card-excerpt"
                  className={styles.textarea}
                  aria-label={t('excerpt')}
                  placeholder={t('excerptPlaceholder')}
                  value={excerpt}
                  maxLength={EXCERPT_MAX_CHARS}
                  rows={4}
                  onKeyDown={onKeyDown}
                  onChange={(event) => setExcerpt(event.target.value)}
                />
              </div>

              <div className={styles.metaGrid}>
                <div className={styles.inputField}>
                  <label className={styles.fieldLabel} htmlFor="share-card-title">
                    {t('title')}
                  </label>
                  <input
                    id="share-card-title"
                    className={styles.input}
                    aria-label={t('title')}
                    placeholder={t('titlePlaceholder')}
                    value={title}
                    maxLength={TITLE_MAX_CHARS}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>

                <div className={styles.inputField}>
                  <label className={styles.fieldLabel} htmlFor="share-card-summary">
                    {t('summary')}
                  </label>
                  <textarea
                    id="share-card-summary"
                    className={styles.textarea}
                    aria-label={t('summary')}
                    placeholder={t('summaryPlaceholder')}
                    value={summary}
                    maxLength={SUMMARY_MAX_CHARS}
                    rows={3}
                    onChange={(event) => setSummary(event.target.value)}
                  />
                </div>

                <div className={styles.inputField}>
                  <label className={styles.fieldLabel} htmlFor="share-card-url">
                    {t('url')}
                  </label>
                  <input
                    id="share-card-url"
                    className={styles.input}
                    aria-label={t('url')}
                    placeholder={t('urlPlaceholder')}
                    value={url}
                    maxLength={2048}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                </div>

                <div className={styles.inputField}>
                  <label className={styles.fieldLabel} htmlFor="share-card-site">
                    {t('siteName')}
                  </label>
                  <input
                    id="share-card-site"
                    className={styles.input}
                    aria-label={t('siteName')}
                    value={siteName}
                    maxLength={SITE_NAME_MAX_CHARS}
                    onChange={(event) => setSiteName(event.target.value)}
                  />
                </div>
              </div>

              {!urlValid ? (
                <div className={styles.warning} role="alert">
                  <IconAlertTriangle size={13} className={styles.warningIcon} />
                  <span>{t('urlInvalid')}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>{t('appearance')}</span>
            </div>
            <div className={styles.cardBody}>
              <fieldset className={styles.group}>
                <legend className={styles.groupLabel}>{t('template')}</legend>
                <div className={styles.radioRow} role="radiogroup" aria-label={t('template')}>
                  {TEMPLATE_OPTIONS.map((option) => (
                    <label
                      key={option.id}
                      className={[
                        styles.templateOption,
                        template === option.id ? styles.templateOptionActive : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <input
                        type="radio"
                        className={styles.radioInput}
                        name="share-card-template"
                        value={option.id}
                        checked={template === option.id}
                        onChange={() => {
                          settingsTouchedRef.current = true;
                          setTemplate(option.id);
                          void props.context.storage.set('template', option.id).catch(() => undefined);
                        }}
                      />
                      <span className={styles.swatch} style={{ background: option.swatch }} aria-hidden="true" />
                      <span className={styles.optionLabel}>{t(option.labelKey)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className={styles.group}>
                <legend className={styles.groupLabel}>{t('size')}</legend>
                <div className={styles.radioRow} role="radiogroup" aria-label={t('size')}>
                  {(['portrait', 'square'] as const).map((id) => (
                    <label
                      key={id}
                      className={[
                        styles.templateOption,
                        sizeId === id ? styles.templateOptionActive : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <input
                        type="radio"
                        className={styles.radioInput}
                        name="share-card-size"
                        value={id}
                        checked={sizeId === id}
                        onChange={() => {
                          settingsTouchedRef.current = true;
                          setSizeId(id);
                          void props.context.storage.set('size', id).catch(() => undefined);
                        }}
                      />
                      <span className={styles.optionLabel}>{t(id === 'portrait' ? 'sizePortrait' : 'sizeSquare')}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className={styles.optionsRow}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={watermark}
                    onChange={(event) => {
                      settingsTouchedRef.current = true;
                      setWatermark(event.target.checked);
                      void props.context.storage.set('watermark', event.target.checked).catch(() => undefined);
                    }}
                  />
                  <span className={styles.checkboxText}>{t('watermark')}</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <PreviewPane
          preview={
            <canvas
              ref={canvasRef}
              className={styles.previewCanvas}
              role="img"
              aria-label={`${t('previewLabel')} · ${t(templateNameKeys[template])}${previewTitle !== '' ? ` · ${previewTitle}` : ''}`}
            />
          }
          previewTitle={t('previewLabel')}
          result={result}
          truncatedLabel={truncated ? t('truncated') : null}
          // Empty and invalid URLs both omit the QR block; invalid input is
          // explained by the field-level warning above, while empty input is
          // the silent no-URL degradation specified for the editor.
          noUrlLabel={null}
          statusText={statusText}
          statusTone={statusTone}
          copyLabel={t('copyImage')}
          copiedLabel={t('copied')}
          downloadLabel={t('download')}
          sizeCaption={t('sizeCaption', { width: size.width * 2, height: size.height * 2 })}
          exportDisabled={exportDisabled}
          onCopy={() => void copyImage()}
          onDownload={() => void downloadImage()}
        />
      </div>
      {exportDisabled ? <p className={styles.emptyReason}>{t('exportDisabledEmpty')}</p> : null}
    </div>
  );
}

function formatDateIso(): string {
  // Native Temporal (spec §12.2 discipline); the worker only sees the
  // resolved yyyy-mm-dd string.
  return globalThis.Temporal.Now.plainDateISO().toString();
}
