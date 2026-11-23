import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../core/i18n/i18n-provider';
import type { HistoryRecord } from '../../../core/history/types';
import { WorkbenchApp, type WorkbenchModule } from '../../../entrypoints/workbench/WorkbenchApp';

const modules: WorkbenchModule[] = [
  { id: 'alpha-tool', name: 'Alpha', enabled: true, surface: () => <p>Alpha surface</p> },
  { id: 'zeta-tool', name: 'Zeta', enabled: true, surface: () => <p>Zeta surface</p> },
  { id: 'hidden-tool', name: 'Hidden', enabled: false, surface: () => <p>Hidden surface</p> },
];

afterEach(() => {
  cleanup();
});

describe('workbench shell', () => {
  it('lists enabled modules in the sidebar and loads the selected surface', () => {
    render(
      <I18nProvider locale="en">
        <WorkbenchApp modules={modules} selectedId="alpha-tool" onSelect={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('link', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Hidden' })).not.toBeInTheDocument();
    expect(screen.getByText('Alpha surface')).toBeInTheDocument();
  });

  it('filters the sidebar by search', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider locale="en">
        <WorkbenchApp modules={modules} selectedId="alpha-tool" onSelect={vi.fn()} />
      </I18nProvider>,
    );
    await user.type(screen.getByLabelText('Search modules'), 'Zet');
    expect(screen.queryByRole('link', { name: 'Alpha' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zeta' })).toBeInTheDocument();
  });

  it('marks the module that is actually rendered when no hash is set (L)', () => {
    render(
      <I18nProvider locale="en">
        <WorkbenchApp modules={modules} selectedId={null} onSelect={vi.fn()} />
      </I18nProvider>,
    );
    // selectedId=null renders the first enabled module; its nav entry must
    // carry aria-current so the visible module and the marker agree.
    expect(screen.getByText('Alpha surface')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alpha' })).toHaveAttribute('aria-current', 'page');
  });

  it('falls back when the hash points at an unknown module', () => {
    render(
      <I18nProvider locale="en">
        <WorkbenchApp modules={modules} selectedId="missing-tool" onSelect={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByText('Unknown module')).toBeInTheDocument();
  });

  it('isolates a throwing module behind its own error boundary', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Boom(): React.ReactElement {
      throw new Error('surface crashed');
    }
    render(
      <I18nProvider locale="en">
        <WorkbenchApp
          modules={[{ id: 'boom-tool', name: 'Boom', enabled: true, surface: () => <Boom /> }]}
          selectedId="boom-tool"
          onSelect={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('This module failed.')).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe('workbench history panel (ultrareview batch 6)', () => {
  it('lists records for the selected module and clears them', async () => {
    const user = userEvent.setup();
    const records: HistoryRecord[] = [
      { kind: 'text', moduleId: 'alpha-tool', action: 'encode', createdAt: 1, input: 'hi', output: 'aGk=' },
      { kind: 'file', moduleId: 'alpha-tool', action: 'encode', createdAt: 2, name: 'a.png', size: 12, mime: 'image/png' },
    ];
    const onListHistory = vi.fn(() => Promise.resolve(records));
    const onClearHistory = vi.fn(() => Promise.resolve());
    render(
      <I18nProvider locale="en">
        <WorkbenchApp
          modules={[modules[0] as WorkbenchModule]}
          selectedId="alpha-tool"
          onSelect={vi.fn()}
          onListHistory={onListHistory}
          onClearHistory={onClearHistory}
        />
      </I18nProvider>,
    );
    expect((await screen.findAllByText('encode')).length).toBe(2);
    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.getByText(/a\.png/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear history' }));
    // Clearing asks for confirmation first (H6).
    expect(onClearHistory).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onClearHistory).toHaveBeenCalledWith('alpha-tool');
    await waitFor(() => expect(onListHistory).toHaveBeenCalledTimes(2));
  });

  it('shows an empty hint when the module has no records', async () => {
    render(
      <I18nProvider locale="en">
        <WorkbenchApp
          modules={[modules[0] as WorkbenchModule]}
          selectedId="alpha-tool"
          onSelect={vi.fn()}
          onListHistory={() => Promise.resolve([])}
          onClearHistory={() => Promise.resolve()}
        />
      </I18nProvider>,
    );
    expect(await screen.findByText('No history yet for this module.')).toBeInTheDocument();
  });

  it('shows a visible status when history loading fails', async () => {
    render(
      <I18nProvider locale="en">
        <WorkbenchApp
          modules={[modules[0] as WorkbenchModule]}
          selectedId="alpha-tool"
          onSelect={vi.fn()}
          onListHistory={() => Promise.reject(new Error('storage unavailable'))}
          onClearHistory={() => Promise.resolve()}
        />
      </I18nProvider>,
    );
    expect(await screen.findByRole('status')).toHaveTextContent('History could not be loaded');
  });

  it('renders same-millisecond records without duplicate list identity', async () => {
    const records: HistoryRecord[] = [
      { kind: 'text', moduleId: 'alpha-tool', action: 'encode', createdAt: 10, input: 'a', output: 'b' },
      { kind: 'text', moduleId: 'alpha-tool', action: 'decode', createdAt: 10, input: 'c', output: 'd' },
    ];
    render(
      <I18nProvider locale="en">
        <WorkbenchApp
          modules={[modules[0] as WorkbenchModule]}
          selectedId="alpha-tool"
          onSelect={vi.fn()}
          onListHistory={() => Promise.resolve(records)}
          onClearHistory={() => Promise.resolve()}
        />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
  });
});
