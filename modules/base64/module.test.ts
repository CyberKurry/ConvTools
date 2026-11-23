import { describe, expect, it } from 'vitest';
import manifest from './module.json';

describe('base64 module', () => {
  it('declares first-install defaults and selection actions', () => {
    expect(manifest.id).toBe('base64');
    expect(manifest.defaultEnabled).toBe(true);
    expect(manifest.defaultQuickOrder).toBe(10);
    expect(manifest.surfaces.selectionActions).toEqual(['encode', 'decode']);
  });
});
