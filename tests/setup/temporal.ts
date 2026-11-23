import { Temporal } from '@js-temporal/polyfill';

if (!('Temporal' in globalThis)) {
  Object.defineProperty(globalThis, 'Temporal', { value: Temporal, configurable: true });
}