import { describe, expect, it, vi } from 'vitest';
import type { NamespacedHistory } from '../../core/module-sdk/context';
import type { SelectionActionContext } from '../../core/module-sdk/runtime';
import definition from './index';

const encode = definition.surfaces.selectionActions.find((action) => action.id === 'encode');
const decode = definition.surfaces.selectionActions.find((action) => action.id === 'decode');

function historyStub() {
  return {
    append: vi.fn(() => Promise.resolve()),
    list: vi.fn(() => Promise.resolve([])),
    clear: vi.fn(() => Promise.resolve()),
  } satisfies NamespacedHistory & Record<string, ReturnType<typeof vi.fn>>;
}

function contextStub(history: ReturnType<typeof historyStub>): SelectionActionContext {
  return {
    history,
    storage: {
      get: vi.fn(() => Promise.resolve(undefined)),
      set: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
      clear: vi.fn(() => Promise.resolve()),
    },
    i18n: { locale: 'en', t: (key) => key },
    defaultTimezone: null,
    signal: new AbortController().signal,
    page: vi.fn(() => Promise.resolve(null)),
  };
}

describe('base64 selection actions history', () => {
  it('records encode actions through the selection context', async () => {
    const history = historyStub();
    if (!encode) {
      throw new Error('encode selection action missing');
    }

    const result = await encode.run('hello', contextStub(history));

    expect(result).toBe('aGVsbG8=');
    expect(history.append).toHaveBeenCalledWith({
      kind: 'text',
      action: 'encode',
      input: 'hello',
      output: 'aGVsbG8=',
      format: 'standard',
      corrections: [],
    });
  });

  it('records decode format and tolerance corrections', async () => {
    const history = historyStub();
    if (!decode) {
      throw new Error('decode selection action missing');
    }

    const result = await decode.run('aGVsbG8', contextStub(history));

    expect(result).toBe('hello');
    expect(history.append).toHaveBeenCalledWith({
      kind: 'text',
      action: 'decode',
      input: 'aGVsbG8',
      output: 'hello',
      format: 'standard',
      corrections: ['padding'],
    });
  });

  it('does not record failed decodes', () => {
    const history = historyStub();
    if (!decode) {
      throw new Error('decode selection action missing');
    }

    expect(() => decode.run('!!!not-base64!!!', contextStub(history))).toThrow();
    expect(history.append).not.toHaveBeenCalled();
  });
});
