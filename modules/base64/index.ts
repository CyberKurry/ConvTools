import { createElement, lazy, type ReactElement } from 'react';
import type { ModuleContext } from '../../core/module-sdk/context';
import { defineToolModule } from '../../core/module-sdk';
import manifest from './module.json';
import { decodeBase64, encodeBase64 } from './core/encode';
import { DECODE_ERROR_KEYS } from './core/error-keys';
import { recordTextHistory } from './history';

const Base64Surface = lazy(async () => {
  const module = await import('./ui/Base64Surface');
  return { default: module.Base64Surface };
});

let activeContext: ModuleContext | null = null;

function PopupSurface(): ReactElement | null {
  return activeContext ? createElement(Base64Surface, { context: activeContext, mode: 'popup' }) : null;
}

function WorkbenchSurface(): ReactElement | null {
  return activeContext ? createElement(Base64Surface, { context: activeContext, mode: 'workbench' }) : null;
}

export default defineToolModule({
  manifest,
  runtime: {
    id: 'base64',
    icon: manifest.icon,
    surfaces: {
      popup: { Component: PopupSurface },
      workbench: { Component: WorkbenchSurface },
      settings: null,
      selectionActions: [
        {
          id: 'encode',
          label: 'encode',
          run: (selectedText, context) => {
            const encoded = encodeBase64(selectedText, { format: 'standard' });
            // History must never turn a conversion into a failure (spec §15):
            // the write happens in the background and swallows its own errors.
            void recordTextHistory(context.history, {
              action: 'encode',
              input: selectedText,
              output: encoded,
              format: 'standard',
              corrections: [],
            }).catch(() => undefined);
            return encoded;
          },
        },
        {
          id: 'decode',
          label: 'decode',
          run: (selectedText, context) => {
            const result = decodeBase64(selectedText, 'tolerant');
            if (!result.ok) {
              throw new Error(context.i18n.t(DECODE_ERROR_KEYS[result.code]));
            }
            if (result.text === null) {
              throw new Error(context.i18n.t('binaryPreview'));
            }
            void recordTextHistory(context.history, {
              action: 'decode',
              input: selectedText,
              output: result.text,
              format: result.format,
              corrections: result.corrections.map((item) => item.code),
            }).catch(() => undefined);
            return result.text;
          },
        },
      ],
    },
    activate: (context) => {
      activeContext = context;
      return Promise.resolve(() => {
        activeContext = null;
      });
    },
  },
});
