import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModuleContext } from '../../../core/module-sdk/context';
import en from '../locales/en.json';
import { TimestampSurface } from './TimestampSurface';

afterEach(() => {
  cleanup();
  if (documentHiddenDescriptor) {
    Object.defineProperty(document, 'hidden', documentHiddenDescriptor);
  }
});

const documentHiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');

function stubContext(
  history: { append: (record: unknown) => Promise<void> } = { append: () => Promise.resolve() },
): ModuleContext {
  return {
    moduleId: 'timestamp',
    storage: {
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    },
    history: {
      append: history.append,
      list: () => Promise.resolve([]),
      clear: () => Promise.resolve(),
    },
    i18n: { t: (key) => (en as Record<string, string>)[key] ?? key, locale: 'en' },
    theme: { scheme: 'light' },
    defaultTimezone: null,
    permissions: { request: () => Promise.resolve(false), contains: () => Promise.resolve(false) },
    network: { request: () => Promise.resolve(undefined) },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    signal: new AbortController().signal,
  };
}

describe('TimestampSurface', () => {
  it('records history when the current time is pinned as the input', async () => {
    const user = userEvent.setup();
    const history = { append: vi.fn((_record: unknown) => Promise.resolve()) };
    const fixed = globalThis.Temporal.Instant.from('2024-05-06T07:08:09.123Z');
    render(<TimestampSurface context={stubContext(history)} clock={{ now: () => fixed }} />);
    await user.click(screen.getByRole('button', { name: 'Use current time' }));
    expect(history.append).toHaveBeenCalledTimes(1);
    const record = history.append.mock.calls[0]?.[0] as { input?: string; output?: string };
    expect(record.input).toBe('1714979289123');
    expect(record.output).toBe('2024-05-06T07:08:09.123Z');
  });


  it('converts a seconds timestamp to ISO UTC', async () => {
    const user = userEvent.setup();
    render(<TimestampSurface context={stubContext()} />);
    await user.type(screen.getByLabelText('Timestamp'), '0');
    await user.selectOptions(screen.getByLabelText('Unit'), 'seconds');
    await user.click(screen.getByRole('button', { name: 'Convert to date' }));
    expect(screen.getByText(/1970-01-01T00:00:00Z/)).toBeInTheDocument();
  });

  it('asks the user to choose when a local time is repeated', async () => {
    const user = userEvent.setup();
    render(<TimestampSurface context={stubContext()} />);
    const zone = screen.getByLabelText('Timezone');
    await user.selectOptions(zone, 'America/New_York');
    const datetime = screen.getByLabelText('Date and time');
    await user.clear(datetime);
    await user.type(datetime, '2024-11-03T01:30:00');
    await user.click(screen.getByRole('button', { name: 'Convert to timestamp' }));
    expect(screen.getByText(/occurs twice/)).toBeInTheDocument();
  });
});

describe('TimestampSurface ultrareview batch 4', () => {
  it('shows a localized error for an unparseable local date-time', async () => {
    const user = userEvent.setup();
    render(<TimestampSurface context={stubContext()} />);
    const datetime = screen.getByLabelText('Date and time');
    await user.clear(datetime);
    await user.type(datetime, 'not-a-date');
    await user.click(screen.getByRole('button', { name: 'Convert to timestamp' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot parse the date-time');
  });

  it('rejects an impossible calendar date instead of silently constraining it', async () => {
    const user = userEvent.setup();
    render(<TimestampSurface context={stubContext()} />);
    const datetime = screen.getByLabelText('Date and time');
    await user.clear(datetime);
    await user.type(datetime, '2024-02-30T12:00:00');
    await user.click(screen.getByRole('button', { name: 'Convert to timestamp' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the selected timezone row for forward conversion', async () => {
    const user = userEvent.setup();
    render(<TimestampSurface context={stubContext()} />);
    await user.selectOptions(screen.getByLabelText('Timezone'), 'Asia/Shanghai');
    await user.type(screen.getByLabelText('Timestamp'), '0');
    await user.selectOptions(screen.getByLabelText('Unit'), 'seconds');
    await user.click(screen.getByRole('button', { name: 'Convert to date' }));
    expect(screen.getByText('Selected timezone:')).toBeInTheDocument();
    expect(screen.getByText(/\+08:00/)).toBeInTheDocument();
  });

  it('reports an actionable hint when the digit count is ambiguous', async () => {
    const user = userEvent.setup();
    render(<TimestampSurface context={stubContext()} />);
    await user.type(screen.getByLabelText('Timestamp'), '12345678901');
    await user.click(screen.getByRole('button', { name: 'Convert to date' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/seconds or milliseconds/);
  });

  it('writes history when a DST offset choice is confirmed', async () => {
    const user = userEvent.setup();
    const history = { append: vi.fn((_record: unknown) => Promise.resolve()) };
    render(<TimestampSurface context={stubContext(history)} />);
    await user.selectOptions(screen.getByLabelText('Timezone'), 'America/New_York');
    const datetime = screen.getByLabelText('Date and time');
    await user.clear(datetime);
    await user.type(datetime, '2024-11-03T01:30:00');
    await user.click(screen.getByRole('button', { name: 'Convert to timestamp' }));
    await user.click(screen.getByRole('button', { name: /Earlier/ }));
    await waitFor(() => expect(history.append).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/occurs twice/)).not.toBeInTheDocument();
  });

  it('clears a stale ambiguity card when the input changes', async () => {
    const user = userEvent.setup();
    render(<TimestampSurface context={stubContext()} />);
    await user.selectOptions(screen.getByLabelText('Timezone'), 'America/New_York');
    const datetime = screen.getByLabelText('Date and time');
    await user.clear(datetime);
    await user.type(datetime, '2024-11-03T01:30:00');
    await user.click(screen.getByRole('button', { name: 'Convert to timestamp' }));
    expect(screen.getByText(/occurs twice/)).toBeInTheDocument();
    await user.type(datetime, '5');
    expect(screen.queryByText(/occurs twice/)).not.toBeInTheDocument();
  });

  it('does not fall back to the first option when filtering hides the selected zone', async () => {
    const user = userEvent.setup();
    render(<TimestampSurface context={stubContext()} />);
    await user.selectOptions(screen.getByLabelText('Timezone'), 'America/New_York');
    await user.type(screen.getByLabelText('Search timezones'), 'Tokyo');
    const select = screen.getByLabelText('Timezone');
    expect(select).toHaveValue('America/New_York');
  });

  it('rejects empty timestamp input without producing an epoch result or history', async () => {
    const user = userEvent.setup();
    const history = { append: vi.fn((_record: unknown) => Promise.resolve()) };
    render(<TimestampSurface context={stubContext(history)} />);
    await user.click(screen.getByRole('button', { name: 'Convert to date' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot parse the input');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(history.append).not.toHaveBeenCalled();
  });

  it('uses one exact clock sample when filling the current time in auto mode', async () => {
    const user = userEvent.setup();
    const instant = globalThis.Temporal.Instant.from('2024-01-15T12:34:56.789Z');
    const now = vi.fn(() => instant);
    render(<TimestampSurface context={stubContext()} clock={{ now }} />);
    await user.click(screen.getByRole('button', { name: 'Use current time' }));
    expect(screen.getByLabelText('Timestamp')).toHaveValue('1705322096789');
    await user.click(screen.getByRole('button', { name: 'Convert to date' }));
    expect(screen.getByText('2024-01-15T12:34:56.789Z')).toBeInTheDocument();
    expect(now).toHaveBeenCalled();
  });

  it('keeps the displayed result consistent when current time uses seconds', async () => {
    const user = userEvent.setup();
    const instant = globalThis.Temporal.Instant.from('2024-01-15T12:34:56.789Z');
    render(<TimestampSurface context={stubContext()} clock={{ now: () => instant }} />);
    await user.selectOptions(screen.getByLabelText('Unit'), 'seconds');
    await user.click(screen.getByRole('button', { name: 'Use current time' }));
    expect(screen.getByLabelText('Timestamp')).toHaveValue('1705322096');
    expect(screen.getByText('2024-01-15T12:34:56Z')).toBeInTheDocument();
  });

  it('clears a completed result when the input or timezone changes', async () => {
    const user = userEvent.setup();
    render(<TimestampSurface context={stubContext()} />);
    await user.type(screen.getByLabelText('Timestamp'), '0');
    await user.selectOptions(screen.getByLabelText('Unit'), 'seconds');
    await user.click(screen.getByRole('button', { name: 'Convert to date' }));
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Timestamp'), '1');
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Timezone'), 'Asia/Shanghai');
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
  });

  it('shows both UTC offsets in repeated local-time choices', async () => {
    const user = userEvent.setup();
    render(<TimestampSurface context={stubContext()} />);
    await user.selectOptions(screen.getByLabelText('Timezone'), 'America/New_York');
    const datetime = screen.getByLabelText('Date and time');
    await user.clear(datetime);
    await user.type(datetime, '2024-11-03T01:30:00');
    await user.click(screen.getByRole('button', { name: 'Convert to timestamp' }));
    expect(screen.getByRole('button', { name: /Earlier.*-04:00/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Later.*-05:00/ })).toBeInTheDocument();
  });

  it('falls back from an invalid stored timezone to the browser timezone', () => {
    render(<TimestampSurface context={{ ...stubContext(), defaultTimezone: 'Not/AZone' }} />);
    expect(screen.getByLabelText('Timezone')).toHaveValue(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('does not start a live interval while the extension page is hidden', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const setInterval = vi.spyOn(window, 'setInterval');
    render(<TimestampSurface context={stubContext()} />);
    expect(setInterval).not.toHaveBeenCalled();
    setInterval.mockRestore();
  });

  it('keeps a successful conversion visible when history storage fails', async () => {
    const user = userEvent.setup();
    const history = { append: vi.fn(() => Promise.reject(new Error('storage unavailable'))) };
    render(<TimestampSurface context={stubContext(history)} />);
    await user.type(screen.getByLabelText('Timestamp'), '0');
    await user.selectOptions(screen.getByLabelText('Unit'), 'seconds');
    await user.click(screen.getByRole('button', { name: 'Convert to date' }));
    expect(screen.getByText('1970-01-01T00:00:00Z')).toBeInTheDocument();
    expect(await screen.findByText('History could not be saved.')).toBeInTheDocument();
  });

  it('ignores a stale history failure after the input changed (M9)', async () => {
    const user = userEvent.setup();
    const pending: Array<{ reject: (error: unknown) => void }> = [];
    const history = {
      append: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            pending.push({ reject });
          }),
      ),
    };
    render(<TimestampSurface context={stubContext(history)} />);
    await user.type(screen.getByLabelText('Timestamp'), '0');
    await user.selectOptions(screen.getByLabelText('Unit'), 'seconds');
    await user.click(screen.getByRole('button', { name: 'Convert to date' }));
    await waitFor(() => expect(history.append).toHaveBeenCalledTimes(1));
    // The input changes, invalidating the conversion the write belonged to.
    await user.type(screen.getByLabelText('Timestamp'), '1');
    pending[0]?.reject(new Error('storage unavailable'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('History could not be saved.')).not.toBeInTheDocument();
  });
});
