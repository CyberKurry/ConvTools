import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from '../../../core/ui/Button';
import { Dialog } from '../../../core/ui/Dialog';
import { Progress } from '../../../core/ui/Progress';
import { I18nProvider } from '../../../core/i18n/i18n-provider';
import { ThemeProvider } from '../../../core/theme/theme-provider';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});

describe('accessibility primitives', () => {
  it('exposes an accessible name on buttons', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('restores focus and closes a dialog on Escape', async () => {
    const user = userEvent.setup();
    function Harness(): ReactElement {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button">Behind</button>
          <Dialog open={open} title="Confirm" onClose={() => setOpen(false)}>
            <p>Body</p>
          </Dialog>
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps dialog title ids unique when two dialogs are open (L)', () => {
    render(
      <I18nProvider locale="en">
        <>
          <Dialog open title="First" onClose={() => undefined}>
            <p>One</p>
          </Dialog>
          <Dialog open title="Second" onClose={() => undefined}>
            <p>Two</p>
          </Dialog>
        </>
      </I18nProvider>,
    );
    const ids = screen.getAllByRole('heading').map((heading) => heading.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Each dialog's accessible name resolves to its own title.
    expect(screen.getByRole('dialog', { name: 'First' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Second' })).toBeInTheDocument();
  });

  it('announces progress', () => {
    render(<Progress value={40} label="Progress" />);
    expect(screen.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '40');
  });

  it('follows prefers-color-scheme when theme is system', () => {
    const match = mockMatchMedia('(prefers-color-scheme: dark)');
    render(
      <ThemeProvider theme="system">
        <p>themed</p>
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe('dark');
    match.restore();
  });

  it('selects browser language and can persist a manual locale', () => {
    const original = navigator.language;
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'zh-CN' });
    render(
      <I18nProvider locale="auto">
        <span data-testid="locale-probe" />
      </I18nProvider>,
    );
    expect(document.documentElement.lang).toBe('zh-CN');
    cleanup();
    render(
      <I18nProvider locale="en">
        <span />
      </I18nProvider>,
    );
    expect(document.documentElement.lang).toBe('en');
    Object.defineProperty(navigator, 'language', { configurable: true, value: original });
  });
});

function mockMatchMedia(query: string): { restore(): void } {
  const previous = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (q: string): MediaQueryList => ({
      matches: q === query,
      media: q,
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
  return {
    restore() {
      if (previous) {
        Object.defineProperty(window, 'matchMedia', previous);
      }
    },
  };
}
