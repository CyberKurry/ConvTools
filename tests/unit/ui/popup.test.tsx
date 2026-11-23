import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentType, type ReactElement } from 'react';
import type { DndContextProps, Modifier } from '@dnd-kit/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../core/i18n/i18n-provider';
import { PopupApp, type PopupModule } from '../../../entrypoints/popup/PopupApp';

// Capture DndContext configuration while keeping the real drag behavior for
// the other tests: the narrow action popup must disable autoScroll and lock
// drags to the horizontal axis, or edge-ward drags scroll the row away.
const dndProps: DndContextProps[] = [];

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const React = await import('react');
  const RealDndContext = actual.DndContext as ComponentType<DndContextProps>;
  const CapturingDndContext: ComponentType<DndContextProps> = (props) => {
    dndProps.push(props);
    return React.createElement(RealDndContext, props);
  };
  const mocked: Record<string, unknown> = { ...actual, DndContext: CapturingDndContext };
  return mocked;
});

const modules: PopupModule[] = [
  { id: 'alpha-tool', name: 'Alpha', enabled: true },
  { id: 'zeta-tool', name: 'Zeta', enabled: true },
  { id: 'hidden-tool', name: 'Hidden', enabled: false },
];

afterEach(() => {
  cleanup();
  dndProps.length = 0;
});

function renderPopup(
  overrides: Partial<React.ComponentProps<typeof PopupApp>> = {},
): ReturnType<typeof render> {
  return render(
    <I18nProvider locale="en">
      <PopupApp
        modules={modules}
        quickModuleIds={['alpha-tool', 'zeta-tool']}
        lastQuickModuleId="zeta-tool"
        workbenchHref="/workbench.html"
        optionsHref="/options.html"
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onMove={vi.fn()}
        onReorder={vi.fn()}
        {...overrides}
      />
    </I18nProvider>,
  );
}

// Controlled host: arrow navigation follows the selected module the way the
// popup entrypoint drives it through the kernel.
function ControlledPopup(): ReactElement {
  const [last, setLast] = useState('zeta-tool');
  return (
    <I18nProvider locale="en">
      <PopupApp
        modules={modules}
        quickModuleIds={['alpha-tool', 'zeta-tool']}
        lastQuickModuleId={last}
        workbenchHref="/workbench.html"
        optionsHref="/options.html"
        onSelect={setLast}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onMove={vi.fn()}
        onReorder={vi.fn()}
      />
    </I18nProvider>
  );
}

describe('popup shell', () => {
  it('shows generic default quick modules and restores the last-used module', () => {
    renderPopup();
    expect(screen.getByRole('tab', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Zeta' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the module strip horizontally scrollable', () => {
    renderPopup();
    expect(screen.getByRole('tablist')).toHaveStyle({ overflowX: 'auto' });
  });

  it('configures drags for the narrow popup: autoScroll off, horizontal axis locked', () => {
    renderPopup();
    const props = dndProps.at(-1);
    expect(props?.autoScroll).toBe(false);
    const modifiers = props?.modifiers;
    expect(Array.isArray(modifiers)).toBe(true);
    expect(modifiers).toHaveLength(1);
    // Minimal stub: the modifier only reads transform, and a vertical drift
    // must not carry the dragged tab off the strip's axis.
    const args = { transform: { x: 40, y: 17, scaleX: 1, scaleY: 1 } } as Parameters<Modifier>[0];
    expect(modifiers?.[0]?.(args)).toMatchObject({ x: 40, y: 0 });
  });

  it('adds and removes quick modules', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    renderPopup({
      quickModuleIds: ['alpha-tool'],
      lastQuickModuleId: 'alpha-tool',
      onAdd,
      onRemove,
    });
    await user.selectOptions(screen.getByLabelText('Add module'), 'zeta-tool');
    expect(onAdd).toHaveBeenCalledWith('zeta-tool');
    await user.click(screen.getByRole('button', { name: 'Remove module' }));
    expect(onRemove).toHaveBeenCalledWith('alpha-tool');
  });

  it('reorders with explicit keyboard controls', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    renderPopup({ onMove });
    await user.click(screen.getByRole('button', { name: 'Move left' }));
    expect(onMove).toHaveBeenCalledWith('zeta-tool', 'left');
  });

  it('selects a different quick module when its tab is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderPopup({ onSelect });

    await user.click(screen.getByRole('tab', { name: 'Zeta' }));

    expect(onSelect).toHaveBeenCalledWith('zeta-tool');
  });

  it('drops disabled modules from the quick strip', () => {
    renderPopup({ quickModuleIds: ['alpha-tool', 'hidden-tool'], lastQuickModuleId: 'alpha-tool' });
    expect(screen.queryByRole('tab', { name: 'Hidden' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Alpha' })).toBeInTheDocument();
  });

  it('links to the workbench and options pages', () => {
    renderPopup();
    expect(screen.getByRole('link', { name: 'Open workbench' })).toHaveAttribute('href', '/workbench.html');
    expect(screen.getByRole('link', { name: 'Open settings' })).toHaveAttribute('href', '/options.html');
  });

  it('moves between tabs with the arrow keys and keeps one tab in the tab order (M10)', async () => {
    const user = userEvent.setup();
    render(<ControlledPopup />);
    const alpha = screen.getByRole('tab', { name: 'Alpha' });
    const zeta = screen.getByRole('tab', { name: 'Zeta' });
    // Roving tabindex: only the selected tab is reachable with Tab.
    expect(zeta).toHaveAttribute('tabindex', '0');
    expect(alpha).toHaveAttribute('tabindex', '-1');

    zeta.focus();
    await user.keyboard('{ArrowLeft}');
    expect(alpha).toHaveFocus();
    expect(alpha).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowRight}');
    expect(zeta).toHaveFocus();
    expect(zeta).toHaveAttribute('aria-selected', 'true');
  });

  it('wraps arrow navigation around the quick strip (M10)', async () => {
    const user = userEvent.setup();
    render(<ControlledPopup />);
    screen.getByRole('tab', { name: 'Zeta' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Zeta' })).toHaveFocus();
  });

  it('points aria-controls only at panels that exist (M10)', () => {
    renderPopup();
    const tabs = screen.getAllByRole('tab');
    for (const tab of tabs) {
      const controls = tab.getAttribute('aria-controls');
      if (controls === null) {
        continue;
      }
      // A dangling aria-controls is worse than none: the referenced id must
      // resolve to the rendered panel.
      expect(document.getElementById(controls)).not.toBeNull();
    }
    expect(screen.getByRole('tab', { name: 'Zeta' })).toHaveAttribute('aria-controls', 'popup-tabpanel-zeta-tool');
  });
});
