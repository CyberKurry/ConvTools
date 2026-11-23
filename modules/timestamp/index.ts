import { createElement, lazy, type ReactElement } from 'react';
import type { ModuleContext } from '../../core/module-sdk/context';
import { defineToolModule } from '../../core/module-sdk';
import manifest from './module.json';
import { detectUnit } from './core/detect-unit';
import { parseIntegerTimestamp } from './core/instant';
import { browserTimeZone, isValidTimeZone } from './core/timezones';
import { recordTimestampHistory } from './history';

const TimestampSurface = lazy(async () => {
  const module = await import('./ui/TimestampSurface');
  return { default: module.TimestampSurface };
});

let activeContext: ModuleContext | null = null;

function PopupSurface(): ReactElement | null {
  return activeContext ? createElement(TimestampSurface, { context: activeContext }) : null;
}

function WorkbenchSurface(): ReactElement | null {
  return activeContext ? createElement(TimestampSurface, { context: activeContext }) : null;
}

export default defineToolModule({
  manifest,
  runtime: {
    id: 'timestamp',
    icon: manifest.icon,
    surfaces: {
      popup: { Component: PopupSurface },
      workbench: { Component: WorkbenchSurface },
      settings: null,
      selectionActions: [
        {
          id: 'convert',
          label: 'convert',
          run: (selectedText, context) => {
            const trimmed = selectedText.trim();
            const detected = detectUnit(trimmed);
            // No silent guessing (spec §12.1): an ambiguous digit count asks
            // the user to pick a unit in the workbench instead.
            if (detected.unit === 'ambiguous') {
              throw new Error(context.i18n.t('ambiguousUnitOverlay'));
            }
            if (detected.unit === 'invalid') {
              throw new Error(context.i18n.t('invalidTimestamp'));
            }
            const configuredTimeZone = context.defaultTimezone;
            const timeZone = configuredTimeZone && isValidTimeZone(configuredTimeZone)
              ? configuredTimeZone
              : browserTimeZone();
            let parts: ReturnType<typeof parseIntegerTimestamp>;
            try {
              parts = parseIntegerTimestamp(trimmed, detected.unit, timeZone);
            } catch (error) {
              throw new Error(context.i18n.t(error instanceof RangeError ? 'outOfRange' : 'invalidTimestamp'));
            }
            void recordTimestampHistory(context.history, {
              action: 'timestamp-to-date',
              input: trimmed,
              result: parts.isoUtc,
              timeZone,
            }).catch(() => undefined);
            // The overlay contract (spec §12.3) shows the date, the zone, and
            // the epoch seconds/milliseconds alongside copy and expand.
            return [
              parts.isoUtc,
              `(${parts.zoned})`,
              `${context.i18n.t('seconds')}: ${parts.epochSeconds}`,
              `${context.i18n.t('milliseconds')}: ${parts.epochMilliseconds}`,
            ].join('\n');
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
