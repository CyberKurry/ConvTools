import { describe, expect, it } from 'vitest';
import { detectIncognito, TEST_INCOGNITO_OVERRIDE_MARKER } from '../../../core/config/environment';

describe('environment policy', () => {
  it('reads production incognito state only from browser.extension.inIncognitoContext', () => {
    const env = detectIncognito({
      browser: { extension: { inIncognitoContext: true } },
    });
    expect(env.incognito).toBe(true);
  });

  it('defaults to normal mode when the browser API is unavailable', () => {
    expect(detectIncognito({}).incognito).toBe(false);
  });

  it('exposes the test override marker only for later production audits', () => {
    expect(TEST_INCOGNITO_OVERRIDE_MARKER).toBe('CONVTOOLS_TEST_INCOGNITO_OVERRIDE');
  });
});
