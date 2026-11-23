import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../core/i18n/i18n-provider';
import { OptionsApp, type OptionsModule } from '../../../entrypoints/options/OptionsApp';

const modules: OptionsModule[] = [
  { id: 'alpha-tool', name: 'Alpha', enabled: true },
  { id: 'zeta-tool', name: 'Zeta', enabled: false },
];

const networkModules: OptionsModule[] = [
  { id: 'alpha-tool', name: 'Alpha', enabled: true, hasOptionalPermissions: true },
  { id: 'zeta-tool', name: 'Zeta', enabled: false, hasOptionalPermissions: false },
];

afterEach(() => {
  cleanup();
});

describe('options shell', () => {
  it('enables, disables, and offers disable-and-delete-data', async () => {
    const user = userEvent.setup();
    const onEnable = vi.fn();
    const onDisable = vi.fn();
    const onDisableAndDelete = vi.fn();
    render(
      <I18nProvider locale="en">
        <OptionsApp
          modules={modules}
          historyEnabled={false}
          locale="auto"
          theme="system"
          timezone="UTC"
          quickModuleIds={['alpha-tool']}
          onEnable={onEnable}
          onDisable={onDisable}
          onDisableAndDelete={onDisableAndDelete}
          onHistoryEnabled={vi.fn()}
          onLocale={vi.fn()}
          onTheme={vi.fn()}
          onTimezone={vi.fn()}
          onMoveQuick={vi.fn()}
          onRevokePermission={vi.fn()}
          onClearHistory={vi.fn()}
          onClearAllHistory={vi.fn()}
        />
      </I18nProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Enable Zeta' }));
    expect(onEnable).toHaveBeenCalledWith('zeta-tool');
    await user.click(screen.getByRole('button', { name: 'Disable Alpha' }));
    expect(onDisable).toHaveBeenCalledWith('alpha-tool');
    await user.click(screen.getByRole('button', { name: 'Disable and delete data Alpha' }));
    // The destructive action needs an explicit confirmation (dialog).
    expect(onDisableAndDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onDisableAndDelete).toHaveBeenCalledWith('alpha-tool');
  });

  it('adds and removes quick modules', async () => {
    const user = userEvent.setup();
    const onAddQuick = vi.fn();
    const onRemoveQuick = vi.fn();
    render(
      <I18nProvider locale="en">
        <OptionsApp
          modules={[
            { id: 'alpha-tool', name: 'Alpha', enabled: true },
            { id: 'zeta-tool', name: 'Zeta', enabled: true },
          ]}
          historyEnabled={false}
          locale="en"
          theme="light"
          timezone="UTC"
          quickModuleIds={['alpha-tool']}
          onEnable={vi.fn()}
          onDisable={vi.fn()}
          onDisableAndDelete={vi.fn()}
          onHistoryEnabled={vi.fn()}
          onLocale={vi.fn()}
          onTheme={vi.fn()}
          onTimezone={vi.fn()}
          onMoveQuick={vi.fn()}
          onAddQuick={onAddQuick}
          onRemoveQuick={onRemoveQuick}
          onRevokePermission={vi.fn()}
          onClearHistory={vi.fn()}
          onClearAllHistory={vi.fn()}
        />
      </I18nProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Remove module Alpha' }));
    expect(onRemoveQuick).toHaveBeenCalledWith('alpha-tool');
    await user.selectOptions(screen.getByLabelText('Add module'), 'zeta-tool');
    expect(onAddQuick).toHaveBeenCalledWith('zeta-tool');
  });

  it('only offers permission revocation to modules declaring optional permissions', async () => {
    const user = userEvent.setup();
    const onRevokePermission = vi.fn();
    render(
      <I18nProvider locale="en">
        <OptionsApp
          modules={networkModules}
          historyEnabled={false}
          locale="en"
          theme="light"
          timezone="UTC"
          quickModuleIds={[]}
          onEnable={vi.fn()}
          onDisable={vi.fn()}
          onDisableAndDelete={vi.fn()}
          onHistoryEnabled={vi.fn()}
          onLocale={vi.fn()}
          onTheme={vi.fn()}
          onTimezone={vi.fn()}
          onMoveQuick={vi.fn()}
          onRevokePermission={onRevokePermission}
          onClearHistory={vi.fn()}
          onClearAllHistory={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Revoke permission Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke permission Zeta' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke permission Alpha' }));
    expect(onRevokePermission).toHaveBeenCalledWith('alpha-tool');
  });

  it('toggles history, language, theme, and timezone', async () => {
    const user = userEvent.setup();
    const onHistoryEnabled = vi.fn();
    const onLocale = vi.fn();
    const onTheme = vi.fn();
    const onTimezone = vi.fn();
    render(
      <I18nProvider locale="en">
        <OptionsApp
          modules={modules}
          historyEnabled={false}
          locale="auto"
          theme="system"
          timezone="UTC"
          quickModuleIds={['alpha-tool']}
          onEnable={vi.fn()}
          onDisable={vi.fn()}
          onDisableAndDelete={vi.fn()}
          onHistoryEnabled={onHistoryEnabled}
          onLocale={onLocale}
          onTheme={onTheme}
          onTimezone={onTimezone}
          onMoveQuick={vi.fn()}
          onRevokePermission={vi.fn()}
          onClearHistory={vi.fn()}
          onClearAllHistory={vi.fn()}
        />
      </I18nProvider>,
    );
    await user.click(screen.getByLabelText('Save conversion history on this device'));
    expect(onHistoryEnabled).toHaveBeenCalledWith(true);
    await user.selectOptions(screen.getByLabelText('Language'), 'zh_CN');
    expect(onLocale).toHaveBeenCalledWith('zh_CN');
    await user.selectOptions(screen.getByLabelText('Theme'), 'dark');
    expect(onTheme).toHaveBeenCalledWith('dark');
    await user.selectOptions(screen.getByLabelText('Default timezone'), 'America/New_York');
    expect(onTimezone).toHaveBeenCalledWith('America/New_York');
  });

  it('revokes permissions and clears history', async () => {
    const user = userEvent.setup();
    const onRevokePermission = vi.fn();
    const onClearHistory = vi.fn();
    const onClearAllHistory = vi.fn();
    render(
      <I18nProvider locale="en">
        <OptionsApp
          modules={networkModules}
          historyEnabled={true}
          locale="en"
          theme="light"
          timezone="UTC"
          quickModuleIds={['alpha-tool']}
          onEnable={vi.fn()}
          onDisable={vi.fn()}
          onDisableAndDelete={vi.fn()}
          onHistoryEnabled={vi.fn()}
          onLocale={vi.fn()}
          onTheme={vi.fn()}
          onTimezone={vi.fn()}
          onMoveQuick={vi.fn()}
          onRevokePermission={onRevokePermission}
          onClearHistory={onClearHistory}
          onClearAllHistory={onClearAllHistory}
        />
      </I18nProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Revoke permission Alpha' }));
    expect(onRevokePermission).toHaveBeenCalledWith('alpha-tool');
  });

  it('confirms before clearing history (H6)', async () => {
    const user = userEvent.setup();
    const onClearHistory = vi.fn();
    const onClearAllHistory = vi.fn();
    render(
      <I18nProvider locale="en">
        <OptionsApp
          modules={networkModules}
          historyEnabled={true}
          locale="en"
          theme="light"
          timezone="UTC"
          quickModuleIds={['alpha-tool']}
          onEnable={vi.fn()}
          onDisable={vi.fn()}
          onDisableAndDelete={vi.fn()}
          onHistoryEnabled={vi.fn()}
          onLocale={vi.fn()}
          onTheme={vi.fn()}
          onTimezone={vi.fn()}
          onMoveQuick={vi.fn()}
          onRevokePermission={vi.fn()}
          onClearHistory={onClearHistory}
          onClearAllHistory={onClearAllHistory}
        />
      </I18nProvider>,
    );
    // Per-module clear: destructive and irreversible, so it asks first.
    await user.click(screen.getByRole('button', { name: 'Clear history Alpha' }));
    expect(onClearHistory).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onClearHistory).toHaveBeenCalledWith('alpha-tool');

    // Clear-all: same double standard the disable-and-delete dialog already
    // follows.
    await user.click(screen.getByRole('button', { name: 'Clear all history' }));
    // Destructive global clear requires the confirmation dialog.
    expect(onClearAllHistory).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onClearAllHistory).toHaveBeenCalled();
  });

  it('keeps history when the clear confirmation is cancelled (H6)', async () => {
    const user = userEvent.setup();
    const onClearAllHistory = vi.fn();
    render(
      <I18nProvider locale="en">
        <OptionsApp
          modules={modules}
          historyEnabled={true}
          locale="en"
          theme="light"
          timezone="UTC"
          quickModuleIds={['alpha-tool']}
          onEnable={vi.fn()}
          onDisable={vi.fn()}
          onDisableAndDelete={vi.fn()}
          onHistoryEnabled={vi.fn()}
          onLocale={vi.fn()}
          onTheme={vi.fn()}
          onTimezone={vi.fn()}
          onMoveQuick={vi.fn()}
          onRevokePermission={vi.fn()}
          onClearHistory={vi.fn()}
          onClearAllHistory={onClearAllHistory}
        />
      </I18nProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Clear all history' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClearAllHistory).not.toHaveBeenCalled();
  });
});
