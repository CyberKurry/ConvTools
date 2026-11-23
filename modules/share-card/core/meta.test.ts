import { describe, expect, it } from 'vitest';
import type { SelectionPageMeta } from '../../../core/module-sdk/runtime';
import { normalizeSelectionInput, parseShareCardInput } from './meta';

function page(overrides: Partial<SelectionPageMeta> = {}): SelectionPageMeta {
  return {
    url: 'https://example.com/article?utm=x',
    title: 'Example title',
    description: 'Example description',
    siteName: 'Example Site',
    ...overrides,
  };
}

describe('normalizeSelectionInput', () => {
  it('builds a v1 payload from the selection and page metadata', () => {
    expect(normalizeSelectionInput('  quoted   text  ', page())).toEqual({
      version: 1,
      excerpt: 'quoted text',
      title: 'Example title',
      summary: 'Example description',
      url: 'https://example.com/article?utm=x',
      siteName: 'Example Site',
    });
  });

  it('collapses whitespace and strips control characters from the excerpt', () => {
    const dirty = 'line1\u0007line2\n\nline3\tend';
    expect(normalizeSelectionInput(dirty, page()).excerpt).toBe('line1 line2 line3 end');
  });

  it('falls back to the url host when the site name is missing', () => {
    expect(normalizeSelectionInput('x', page({ siteName: null })).siteName).toBe('example.com');
  });

  it('rejects non-http url schemes and missing urls', () => {
    expect(normalizeSelectionInput('x', page({ url: 'javascript:alert(1)' })).url).toBeNull();
    expect(normalizeSelectionInput('x', page({ url: null })).url).toBeNull();
    expect(normalizeSelectionInput('x', page({ url: 'not a url' })).url).toBeNull();
  });

  it('rejects URL userinfo so credentials never enter a QR payload', () => {
    expect(normalizeSelectionInput('x', page({ url: 'https://user:secret@example.com/article' })).url).toBeNull();
  });

  it('survives a fully unavailable page', () => {
    expect(normalizeSelectionInput('solo', null)).toEqual({
      version: 1,
      excerpt: 'solo',
      title: null,
      summary: null,
      url: null,
      siteName: null,
    });
  });

  it('clamps every text field to its input cap', () => {
    const huge = page({
      title: 't'.repeat(500),
      description: 'd'.repeat(500),
    });
    const input = normalizeSelectionInput('e'.repeat(500), huge);
    expect(input.excerpt.length).toBeLessThanOrEqual(300);
    expect(input.title?.length).toBeLessThanOrEqual(80);
    expect(input.summary?.length).toBeLessThanOrEqual(120);
  });

  it('bounds hostile handoff values, rejects oversized urls, and restores host fallback', () => {
    const input = parseShareCardInput({
      version: 1,
      excerpt: '😀'.repeat(500),
      title: 't'.repeat(500),
      summary: 's'.repeat(500),
      url: `https://${'a'.repeat(5000)}.example.com/long`,
      siteName: '',
    });
    expect(input).not.toBeNull();
    expect(input?.excerpt.endsWith('…')).toBe(true);
    expect([...input?.excerpt ?? '']).toHaveLength(300);
    expect(input?.title).toHaveLength(80);
    expect(input?.summary).toHaveLength(120);
    expect(input?.url).toBeNull();
    expect(input?.siteName).toBeNull();

    const fallback = parseShareCardInput({
      version: 1,
      excerpt: 'x',
      url: 'https://example.com/a',
      siteName: '',
    });
    expect(fallback?.siteName).toBe('example.com');
  });
});
