import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from '../../../entrypoints/workbench/HistoryPanel';
import { AppProviders } from '../../../core/ui/AppProviders';
import type { HistoryRecord } from '../../../core/history/types';

vi.mock('../../../entrypoints/workbench/WorkbenchApp.module.css', () => ({
  default: new Proxy({}, { get: (_target, key: string) => key }),
}));

const previousMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    }),
  });
});
afterAll(() => {
  if (previousMatchMedia) {
    Object.defineProperty(window, 'matchMedia', previousMatchMedia);
  }
});

function renderPanel(records: HistoryRecord[], onClear: () => Promise<void> = () => Promise.resolve()): ReactElement | void {
  render(
    <AppProviders locale="en" theme="system">
      <HistoryPanel
        moduleId="share-card"
        moduleName="Share Card"
        onList={() => Promise.resolve(records)}
        onClear={onClear}
      />
    </AppProviders>,
  );
}

describe('HistoryPanel clear confirmation', () => {
  it('asks before deleting the module history (H6)', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn(() => Promise.resolve());
    renderPanel([{ moduleId: 'share-card', kind: 'text', action: 'encode', input: 'a', output: 'b', createdAt: Date.now() }], onClear);
    await user.click(await screen.findByRole('button', { name: 'Clear history' }));
    expect(onClear).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onClear).toHaveBeenCalledWith('share-card'));
  });

  it('keeps the history when the confirmation is cancelled (H6)', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn(() => Promise.resolve());
    renderPanel([{ moduleId: 'share-card', kind: 'text', action: 'encode', input: 'a', output: 'b', createdAt: Date.now() }], onClear);
    await user.click(await screen.findByRole('button', { name: 'Clear history' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClear).not.toHaveBeenCalled();
  });
});

describe('HistoryPanel file source urls', () => {
  it('shows the truncated source url under a file record that has one', async () => {
    const longUrl = `https://example.com/${'a'.repeat(120)}`;
    renderPanel([
      {
        kind: 'file',
        moduleId: 'share-card',
        action: 'generate',
        createdAt: 1,
        name: 'share-card-paper-2160x2880.png',
        size: 2048,
        mime: 'image/png',
        sourceUrl: longUrl,
      },
    ]);
    await screen.findByText('share-card-paper-2160x2880.png');
    // Both the wrapping <p> and the <code> carry the truncated string.
    const shown = screen.getAllByText((_, element) =>
      element?.textContent === `${longUrl.slice(0, 80)}…` ? true : false,
    );
    expect(shown.length).toBeGreaterThan(0);
  });

  it('shows no url line for file records without a source url', async () => {
    renderPanel([
      {
        kind: 'file',
        moduleId: 'base64',
        action: 'encode',
        createdAt: 2,
        name: 'photo.jpg',
        size: 10,
        mime: 'image/jpeg',
      },
    ]);
    await screen.findByText('photo.jpg');
    expect(screen.queryByText(/https?:\/\//)).not.toBeInTheDocument();
  });
});
