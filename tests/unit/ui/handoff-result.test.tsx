import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HandoffResult } from '../../../entrypoints/workbench/HandoffResult';
import { I18nProvider } from '../../../core/i18n/i18n-provider';

vi.mock('../../../entrypoints/workbench/WorkbenchApp.module.css', () => ({
  default: new Proxy({}, { get: (_target, key: string) => key }),
}));

describe('HandoffResult', () => {
  it('consumes the token once and renders the result with a copy action', async () => {
    const consume = vi.fn().mockResolvedValue({ result: 'decoded text' });
    render(<HandoffResult token="token-1" consume={consume} />);

    await waitFor(() => expect(consume).toHaveBeenCalledWith('token-1'));
    expect(consume).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('decoded text')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /复制|Copy/i })).toBeInTheDocument();
    expect(screen.queryByText(/handoffLoading/)).not.toBeInTheDocument();
  });

  it('shows the missing state when the token was already consumed or expired', async () => {
    const consume = vi.fn<(token: string) => Promise<{ result: string } | null>>().mockResolvedValue(null);
    render(<HandoffResult token="token-2" consume={consume} />);

    await waitFor(() => expect(screen.getByText(/handoffMissing|不再可用|no longer available/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Copy|复制/ })).not.toBeInTheDocument();
  });

  it('ignores a slow settle after unmount without state updates', () => {
    let resolveLate: (value: { result: string } | null) => void = () => undefined;
    const consume = vi.fn().mockImplementation(
      () => new Promise<{ result: string } | null>((resolve) => {
        resolveLate = resolve;
      }),
    );
    const { unmount } = render(<HandoffResult token="token-3" consume={consume} />);
    unmount();
    expect(() => resolveLate({ result: 'late' })).not.toThrow();
  });

  it('shows a localized manual-copy fallback when clipboard access fails', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) },
    });
    render(
      <I18nProvider locale="en">
        <HandoffResult token="token-4" consume={vi.fn().mockResolvedValue({ result: 'decoded text' })} />
      </I18nProvider>,
    );
    await user.click(await screen.findByRole('button', { name: /复制|Copy/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Select the result|请选中/);
    expect(screen.getByText('decoded text')).toHaveAttribute('tabindex', '0');
  });
});
