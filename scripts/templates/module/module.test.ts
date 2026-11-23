import { describe, expect, it } from 'vitest';
import manifest from './module.json';

describe('{{id}} module', () => {
  it('declares a matching kebab-case id', () => {
    expect(manifest.id).toBe('{{id}}');
    expect(manifest.defaultEnabled).toBe(false);
    expect(manifest.defaultQuickOrder).toBeNull();
  });
});
