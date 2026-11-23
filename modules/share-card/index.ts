import { createElement, lazy, type ReactElement } from 'react';
import type { ModuleContext } from '../../core/module-sdk/context';
import type { SelectionWorkbenchInputResult } from '../../core/module-sdk/runtime';
import { defineToolModule } from '../../core/module-sdk';
import manifest from './module.json';
import { normalizeSelectionInput } from './core/meta';

const CardSurface = lazy(async () => {
  const module = await import('./ui/CardSurface');
  return { default: module.CardSurface };
});

let activeContext: ModuleContext | null = null;

function WorkbenchSurface(props: { readonly initialInput?: unknown }): ReactElement | null {
  return activeContext ? createElement(CardSurface, { context: activeContext, initialInput: props.initialInput }) : null;
}

export default defineToolModule({
  manifest,
  runtime: {
    id: 'share-card',
    icon: manifest.icon,
    surfaces: {
      popup: null,
      workbench: { Component: WorkbenchSurface },
      settings: null,
      selectionActions: [
        {
          id: 'generate',
          label: 'generate',
          run: async (selectedText, context): Promise<SelectionWorkbenchInputResult> => {
            // No rendering here (the background must stay short-lived): hand
            // the normalized input to the workbench, which owns the worker,
            // the editor, and the export-time history record.
            const page = await context.page();
            return { kind: 'workbench-input', data: normalizeSelectionInput(selectedText, page) };
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
