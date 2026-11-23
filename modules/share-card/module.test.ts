import { describe, expect, it } from 'vitest';
import manifest from './module.json';
import definition from './index';

describe('share-card module', () => {
  it('declares a matching id with the raised core api range', () => {
    expect(manifest.id).toBe('share-card');
    expect(manifest.coreApiRange).toBe('^1.1.0');
    expect(definition.id).toBe('share-card');
    expect(manifest.defaultEnabled).toBe(true);
    // v1 stays out of the popup quick bar and ships no surfaces yet.
    expect(manifest.surfaces.popup).toBe(false);
    expect(manifest.defaultQuickOrder).toBeNull();
    expect(manifest.surfaces.selectionActions).toEqual(['generate']);
  });
});
