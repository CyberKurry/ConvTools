import { describe, expect, it } from 'vitest';
import {
  isSelectionImageResult,
  isSelectionWorkbenchInputResult,
  type SelectionActionResult,
  type SelectionImageResult,
  type SelectionWorkbenchInputResult,
} from '../../../core/module-sdk/runtime';

function imageResult(): SelectionImageResult {
  return {
    kind: 'image',
    mime: 'image/png',
    dataUrl: 'data:image/png;base64,AAAA',
    alt: 'Share card: Example',
    fileName: 'share-card-paper-2160x2880.png',
  };
}

function workbenchInputResult(): SelectionWorkbenchInputResult {
  return { kind: 'workbench-input', data: { version: 1 } };
}

describe('selection action result guards', () => {
  it('accepts all three result variants as the action union', () => {
    const results: SelectionActionResult[] = [
      'plain text',
      imageResult(),
      workbenchInputResult(),
    ];
    expect(results).toHaveLength(3);
  });

  it('detects image results and rejects other variants', () => {
    expect(isSelectionImageResult(imageResult())).toBe(true);
    expect(isSelectionImageResult('text')).toBe(false);
    expect(isSelectionImageResult(workbenchInputResult())).toBe(false);
    expect(isSelectionImageResult(null)).toBe(false);
    expect(isSelectionImageResult(undefined)).toBe(false);
    expect(isSelectionImageResult({ kind: 'image' })).toBe(false);
    expect(isSelectionImageResult({ ...imageResult(), mime: 'image/webp' })).toBe(false);
  });

  it('detects workbench-input results and rejects other variants', () => {
    expect(isSelectionWorkbenchInputResult(workbenchInputResult())).toBe(true);
    expect(isSelectionWorkbenchInputResult('text')).toBe(false);
    expect(isSelectionWorkbenchInputResult(imageResult())).toBe(false);
    expect(isSelectionWorkbenchInputResult(null)).toBe(false);
    expect(isSelectionWorkbenchInputResult({ kind: 'workbench-input' })).toBe(false);
    expect(isSelectionWorkbenchInputResult({ kind: 'workbench-input', data: undefined })).toBe(false);
  });
});
