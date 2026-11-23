import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HandoffEntry } from '../../../entrypoints/workbench/HandoffEntry';
import { HandoffResult } from '../../../entrypoints/workbench/HandoffResult';
import { I18nProvider } from '../../../core/i18n/i18n-provider';

vi.mock('../../../entrypoints/workbench/WorkbenchApp.module.css', () => ({
  default: new Proxy({}, { get: (_target, key: string) => key }),
}));

describe('HandoffEntry token changes', () => {
  it('clears the previous result while a new token is consumed (L)', async () => {
    const first = vi.fn().mockResolvedValue({ moduleId: 'base64', result: 'OLD RESULT' });
    const { rerender } = render(
      <I18nProvider locale="en">
        <HandoffEntry token="tok-a" consume={first} onInput={vi.fn()} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText('OLD RESULT')).toBeInTheDocument());

    // The hash is edited (or a new hand-off link pasted) in the same tab: the
    // card must not keep rendering the previous token's payload.
    const second = vi.fn(() => new Promise<never>(() => undefined));
    rerender(
      <I18nProvider locale="en">
        <HandoffEntry token="tok-b" consume={second} onInput={vi.fn()} />
      </I18nProvider>,
    );
    await waitFor(() => expect(second).toHaveBeenCalledWith('tok-b'));
    expect(screen.queryByText('OLD RESULT')).not.toBeInTheDocument();
  });

  it('renders the new result instead of the previous one (L)', async () => {
    const first = vi.fn().mockResolvedValue({ moduleId: 'base64', result: 'OLD RESULT' });
    const { rerender } = render(
      <I18nProvider locale="en">
        <HandoffEntry token="tok-a" consume={first} onInput={vi.fn()} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText('OLD RESULT')).toBeInTheDocument());

    const second = vi.fn().mockResolvedValue({ moduleId: 'base64', result: 'NEW RESULT' });
    rerender(
      <I18nProvider locale="en">
        <HandoffEntry token="tok-b" consume={second} onInput={vi.fn()} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText('NEW RESULT')).toBeInTheDocument());
    expect(screen.queryByText('OLD RESULT')).not.toBeInTheDocument();
  });

  it('re-runs the consume once per token', async () => {
    const consume = vi.fn().mockResolvedValue({ moduleId: 'base64', result: 'R' });
    const { rerender } = render(
      <I18nProvider locale="en">
        <HandoffEntry token="tok-a" consume={consume} onInput={vi.fn()} />
      </I18nProvider>,
    );
    await waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
    rerender(
      <I18nProvider locale="en">
        <HandoffEntry token="tok-a" consume={consume} onInput={vi.fn()} />
      </I18nProvider>,
    );
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it('marks the card missing when the consume fails (L)', async () => {
    const consume = vi.fn().mockRejectedValue(new Error('runtime gone'));
    render(
      <I18nProvider locale="en">
        <HandoffEntry token="tok-a" consume={consume} onInput={vi.fn()} />
      </I18nProvider>,
    );
    expect(await screen.findByText(/no longer available|handoffMissing/i)).toBeInTheDocument();
  });
});

describe('HandoffResult copy fallback', () => {
  it('surfaces the manual copy hint when the clipboard is unavailable', async () => {
    const consume = vi.fn().mockResolvedValue({ result: 'value' });
    const writeText = vi.fn(() => Promise.reject(new Error('denied')));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(
      <I18nProvider locale="en">
        <HandoffResult token="t" consume={consume} />
      </I18nProvider>,
    );
    const button = await screen.findByRole('button', { name: /Copy/i });
    button.click();
    await waitFor(() => expect(writeText).toHaveBeenCalled());
  });
});
