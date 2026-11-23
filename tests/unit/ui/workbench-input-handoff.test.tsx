import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState, type ReactElement } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HandoffEntry } from '../../../entrypoints/workbench/HandoffEntry';
import { ModuleSurface } from '../../../core/ui/ModuleSurface';
import { WorkbenchApp } from '../../../entrypoints/workbench/WorkbenchApp';
import { AppProviders } from '../../../core/ui/AppProviders';

vi.mock('../../../entrypoints/workbench/WorkbenchApp.module.css', () => ({
  default: new Proxy({}, { get: (_target, key: string) => key }),
}));

// AppProviders' ThemeProvider reads the OS scheme; jsdom has no matchMedia.
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

function withProviders(ui: ReactElement): ReactElement {
  return (
    <AppProviders locale="en" theme="system">
      {ui}
    </AppProviders>
  );
}

describe('HandoffEntry', () => {
  it('hands an input payload to the parent exactly once and renders nothing itself', async () => {
    const consume = vi.fn().mockResolvedValue({
      moduleId: 'share-card',
      input: { version: 1, excerpt: 'quoted' },
    });
    const onInput = vi.fn();
    render(
      withProviders(
        <HandoffEntry token="tok-input" consume={consume} onInput={onInput} />,
      ),
    );

    await waitFor(() => expect(onInput).toHaveBeenCalledTimes(1));
    expect(onInput).toHaveBeenCalledWith('share-card', { version: 1, excerpt: 'quoted' });
    expect(consume).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/handoffMissing|no longer available|不再可用/i)).not.toBeInTheDocument();
  });

  it('consumes once even under StrictMode double effects', async () => {
    const consume = vi.fn().mockResolvedValue({
      moduleId: 'share-card',
      input: { version: 1, excerpt: 'quoted' },
    });
    const onInput = vi.fn();
    render(
      withProviders(
        <StrictMode>
          <HandoffEntry token="tok-strict" consume={consume} onInput={onInput} />
        </StrictMode>,
      ),
    );

    await waitFor(() => expect(onInput).toHaveBeenCalledTimes(1));
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it('does not update a handoff route after unmount', async () => {
    let resolveLate: (value: { moduleId: string; input: unknown } | null) => void = () => undefined;
    const consume = vi.fn(
      () => new Promise<{ moduleId: string; input: unknown } | null>((resolve) => {
        resolveLate = resolve;
      }),
    );
    const onInput = vi.fn();
    const { unmount } = render(withProviders(<HandoffEntry token="tok-late" consume={consume} onInput={onInput} />));
    unmount();
    resolveLate({ moduleId: 'share-card', input: { version: 1 } });
    await Promise.resolve();
    expect(onInput).not.toHaveBeenCalled();
  });

  it('renders the result view for a result payload', async () => {
    const consume = vi.fn().mockResolvedValue({ moduleId: 'base64', result: 'decoded text' });
    render(withProviders(<HandoffEntry token="tok-result" consume={consume} onInput={vi.fn()} />));

    await waitFor(() => expect(screen.getByText('decoded text')).toBeInTheDocument());
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it('renders the missing view for an expired or invalid payload', async () => {
    const consume = vi.fn().mockResolvedValue(null);
    render(withProviders(<HandoffEntry token="tok-missing" consume={consume} onInput={vi.fn()} />));

    await waitFor(() => expect(screen.getByText(/handoffMissing|no longer available/i)).toBeInTheDocument());
  });
});

describe('workbench input routing', () => {
  function ProbeSurface(props: { readonly initialInput?: unknown }): ReactElement {
    return <div data-testid="probe-input">{JSON.stringify(props.initialInput ?? null)}</div>;
  }

  function EditableProbe(props: { readonly initialInput?: unknown }): ReactElement {
    const [value, setValue] = useState(JSON.stringify(props.initialInput ?? null));
    return <input aria-label="editable handoff" value={value} onChange={(event) => setValue(event.target.value)} />;
  }

  it('passes the handoff input to the matching module surface', () => {
    render(
      withProviders(
        <WorkbenchApp
          modules={[{ id: 'share-card', name: 'Share Card', enabled: true, surface: ProbeSurface }]}
          selectedId="share-card"
          onSelect={() => undefined}
          inputHandoff={{ moduleId: 'share-card', input: { version: 1, excerpt: 'abc' } }}
        />,
      ),
    );
    expect(screen.getByTestId('probe-input')).toHaveTextContent('{"version":1,"excerpt":"abc"}');
  });

  it('passes no input when the handoff targeted a different module', () => {
    render(
      withProviders(
        <WorkbenchApp
          modules={[{ id: 'share-card', name: 'Share Card', enabled: true, surface: ProbeSurface }]}
          selectedId="share-card"
          onSelect={() => undefined}
          inputHandoff={{ moduleId: 'other-module', input: { version: 1 } }}
        />,
      ),
    );
    expect(screen.getByTestId('probe-input')).toHaveTextContent('null');
  });

  it('ModuleSurface forwards initialInput to any surface that accepts it', () => {
    render(
      withProviders(
        <ModuleSurface moduleId="share-card" Surface={ProbeSurface} initialInput={{ version: 7 }} />,
      ),
    );
    expect(screen.getByTestId('probe-input')).toHaveTextContent('{"version":7}');
  });

  it('does not reapply the original handoff after switching away and back', async () => {
    const user = userEvent.setup();
    function Harness(): ReactElement {
      const [selectedId, setSelectedId] = useState('share-card');
      return (
        <WorkbenchApp
          modules={[
            { id: 'share-card', name: 'Share Card', enabled: true, surface: EditableProbe },
            { id: 'other', name: 'Other', enabled: true, surface: ProbeSurface },
          ]}
          selectedId={selectedId}
          onSelect={setSelectedId}
          inputHandoff={{ moduleId: 'share-card', input: { version: 1, excerpt: 'original' } }}
        />
      );
    }
    render(withProviders(<Harness />));
    const input = screen.getByLabelText('editable handoff');
    await user.clear(input);
    await user.type(input, 'edited');
    await user.click(screen.getByRole('link', { name: 'Other' }));
    await user.click(screen.getByRole('link', { name: 'Share Card' }));
    expect(screen.getByLabelText('editable handoff')).toHaveValue('null');
    expect(screen.getByLabelText('editable handoff')).not.toHaveValue('{"version":1,"excerpt":"original"}');
  });
});
