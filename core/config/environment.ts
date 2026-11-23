export const TEST_INCOGNITO_OVERRIDE_MARKER = 'CONVTOOLS_TEST_INCOGNITO_OVERRIDE';

export interface BrowserIncognitoHost {
  readonly browser?: {
    readonly extension?: {
      readonly inIncognitoContext?: boolean;
    };
  };
  readonly location?: {
    readonly search?: string;
  };
}

export interface EnvironmentPolicy {
  readonly incognito: boolean;
}

/**
 * Production always derives incognito from `browser.extension.inIncognitoContext`.
 * The E2E override is compiled only when `import.meta.env.MODE === 'test'`.
 */
export function detectIncognito(host: BrowserIncognitoHost = globalThis): EnvironmentPolicy {
  const production = Boolean(host.browser?.extension?.inIncognitoContext);
  if (import.meta.env.MODE === 'test') {
    const override = readTestOverride(host);
    if (override !== null) {
      return { incognito: override };
    }
  }
  return { incognito: production };
}

function readTestOverride(host: BrowserIncognitoHost): boolean | null {
  const search = host.location?.search;
  if (!search) {
    return null;
  }
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const value = params.get(TEST_INCOGNITO_OVERRIDE_MARKER);
  if (value === '1') {
    return true;
  }
  if (value === '0') {
    return false;
  }
  return null;
}