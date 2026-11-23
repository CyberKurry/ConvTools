import type { DecodeFailure } from './types';

/**
 * Decode failures are internal codes, not user prose: every surface (text
 * panel, selection action) maps them through the same module-locale keys so
 * no English diagnostic can leak into the UI.
 */
export const DECODE_ERROR_KEYS: Record<DecodeFailure['code'], string> = {
  EMPTY: 'errorEmpty',
  INVALID_CHARACTER: 'errorInvalidCharacter',
  INVALID_PADDING: 'errorInvalidPadding',
  INVALID_LENGTH: 'errorInvalidLength',
  INVALID_DATA_URL: 'errorInvalidDataUrl',
};
