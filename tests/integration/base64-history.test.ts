import { describe, expect, it, vi } from 'vitest';
import { recordFileHistory, recordTextHistory } from '../../modules/base64/history';

describe('base64 history adapter', () => {
  it('writes text records through ModuleContext.history', async () => {
    const append = vi.fn(() => Promise.resolve());
    await recordTextHistory(
      { append, list: () => Promise.resolve([]), clear: () => Promise.resolve() },
      {
        action: 'encode',
        input: 'hello',
        output: 'aGVsbG8=',
        format: 'standard',
        corrections: [],
      },
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'text', input: 'hello', output: 'aGVsbG8=' }),
    );
  });

  it('stores file metadata only', async () => {
    const append = vi.fn(() => Promise.resolve());
    await recordFileHistory(
      { append, list: () => Promise.resolve([]), clear: () => Promise.resolve() },
      { action: 'encode', name: 'a.bin', size: 12, mime: 'application/octet-stream' },
    );
    expect(append).toHaveBeenCalled();
    const record = append.mock.calls.at(0)?.at(0) as Record<string, unknown> | undefined;
    expect(record).toEqual(
      expect.objectContaining({ kind: 'file', name: 'a.bin', size: 12, mime: 'application/octet-stream' }),
    );
    expect(record ?? {}).not.toHaveProperty('content');
    expect(record ?? {}).not.toHaveProperty('output');
  });
});
