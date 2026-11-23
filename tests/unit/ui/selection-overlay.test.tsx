import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectionOverlay, type OverlayLabels } from '../../../entrypoints/selection-overlay/SelectionOverlay';

const LABELS: OverlayLabels = {
  copy: 'Copy',
  copied: 'Copied!',
  close: 'Close',
  expand: 'Expand',
  expandFailed: 'Could not open the workbench. Try again.',
  manualCopy: 'Select the result and copy it manually.',
  failed: 'Something went wrong.',
  truncated: 'Preview truncated',
};

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalExecCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');

afterEach(() => {
  cleanup();
  document.getElementById('convtools-overlay-root')?.remove();
  document.getElementById('shadow-overlay-host')?.remove();
  window.getSelection()?.removeAllRanges();
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
  if (originalExecCommandDescriptor) {
    Object.defineProperty(document, 'execCommand', originalExecCommandDescriptor);
  } else {
    Reflect.deleteProperty(document, 'execCommand');
  }
});

function renderOverlay(overrides: Partial<Parameters<typeof SelectionOverlay>[0]> = {}) {
  const onClose = vi.fn();
  const onExpand = vi.fn(() => true);
  const rendered = render(
    <SelectionOverlay
      result="hello"
      actionLabel="decode"
      labels={LABELS}
      canExpand
      onClose={onClose}
      onExpand={onExpand}
      {...overrides}
    />,
  );
  return { onClose, onExpand, unmount: rendered.unmount };
}

describe('selection overlay', () => {
  it('truncates long results and exposes expand/copy/close controls', () => {
    const long = 'x'.repeat(1000);
    renderOverlay({ result: long, actionLabel: 'Base64 encode' });
    expect(screen.getByText('Base64 encode')).toBeInTheDocument();
    expect(screen.getByText(/…$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Expand/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('reports conversion failures instead of an empty result block', () => {
    renderOverlay({ result: '', isError: true });
    expect(screen.getByRole('alert')).toHaveTextContent(LABELS.failed);
  });

  it('shows the module-localized failure message instead of the generic fallback (H4)', () => {
    // The background already puts the module's localized message into the
    // payload result; the error branch must render it rather than collapsing
    // every failure into "Something went wrong." (spec §15).
    renderOverlay({ result: 'Enter a valid Base64 payload.', isError: true });
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid Base64 payload.');
    expect(screen.queryByText(LABELS.failed)).not.toBeInTheDocument();
  });

  it('surfaces a failed expand instead of closing silently (L)', async () => {
    const onExpand = vi.fn(() => Promise.resolve(false));
    renderOverlay({ onExpand });
    await userEvent.click(screen.getByRole('button', { name: /Expand/ }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(LABELS.expandFailed);
    });
  });

  it('keeps a successful expand quiet', async () => {
    const onExpand = vi.fn(() => Promise.resolve(true));
    renderOverlay({ onExpand });
    await userEvent.click(screen.getByRole('button', { name: /Expand/ }));
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closes through the close button, Escape, and outside pointerdown', () => {
    const { onClose } = renderOverlay();
    screen.getByRole('button', { name: 'Close' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('expands to the workbench through the expand control', () => {
    const { onExpand } = renderOverlay();
    screen.getByRole('button', { name: /Expand/ }).click();
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('hides the expand control when the payload has no origin action', () => {
    renderOverlay({ canExpand: false });
    expect(screen.queryByRole('button', { name: /Expand/ })).not.toBeInTheDocument();
  });

  it('moves focus to the dialog on mount and restores it on unmount', () => {
    window.getSelection()?.removeAllRanges();
    const anchor = document.createElement('button');
    anchor.textContent = 'page control';
    document.body.appendChild(anchor);
    anchor.focus();
    expect(document.activeElement).toBe(anchor);

    const { unmount } = renderOverlay();
    expect(document.activeElement).toHaveAttribute('role', 'dialog');
    unmount();
    expect(document.activeElement).toBe(anchor);
    anchor.remove();
  });

  it('keeps the overlay open and copies when a Shadow DOM button is clicked', () => {
    const host = document.createElement('div');
    host.id = 'shadow-overlay-host';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    shadow.appendChild(mount);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const { getByRole } = render(
      <SelectionOverlay result="hello" actionLabel="decode" labels={LABELS} onClose={vi.fn()} onExpand={vi.fn()} />,
      { container: mount },
    );
    const dialog = getByRole('dialog');
    const copyButton = getByRole('button', { name: /Copy/ });
    const pointerDown = new PointerEvent('pointerdown', { bubbles: true, composed: true });
    Object.defineProperty(pointerDown, 'composedPath', {
      configurable: true,
      value: () => [copyButton, dialog, mount, shadow, host, document, window],
    });
    document.dispatchEvent(pointerDown);
    copyButton.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));

    expect(dialog).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to the document copy command when the Clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'));
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    renderOverlay();
    screen.getByRole('button', { name: /Copy/ }).click();

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
    expect(screen.getByText('Copied!')).toBeInTheDocument();
  });

  it('surfaces the manual-copy instruction when every copy path fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });

    renderOverlay();
    screen.getByRole('button', { name: /Copy/ }).click();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(LABELS.manualCopy));
  });

  it('anchors the floating result to viewport coordinates near the selection', () => {
    const anchor = document.createElement('span');
    anchor.textContent = 'selected text';
    document.body.appendChild(anchor);
    const range = document.createRange();
    range.selectNodeContents(anchor);
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(120, 200, 100, 40),
    });
    const selection = window.getSelection();
    if (!selection) {
      throw new Error('selection API unavailable');
    }
    selection.removeAllRanges();
    selection.addRange(range);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 600 });

    renderOverlay();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveStyle({ top: '248px', left: '120px' });
  });
});
