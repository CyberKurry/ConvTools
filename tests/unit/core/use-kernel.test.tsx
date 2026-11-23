import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createKernel, type Kernel } from '../../../core/kernel';
import { useKernelSnapshot } from '../../../core/use-kernel';

afterEach(() => {
  cleanup();
});

function SnapshotProbe(props: { kernel: Kernel }): ReactElement {
  const { snapshot, error, retry } = useKernelSnapshot(props.kernel);
  if (error) {
    return (
      <button type="button" data-testid="kernel-error" onClick={retry}>
        error
      </button>
    );
  }
  return <output data-testid="last-quick-id">{snapshot?.lastQuickModuleId ?? 'loading'}</output>;
}

describe('useKernelSnapshot', () => {
  it('refreshes after a kernel mutation', async () => {
    const kernel = createKernel();
    render(<SnapshotProbe kernel={kernel} />);

    await waitFor(() => expect(screen.getByTestId('last-quick-id')).toHaveTextContent('base64'));

    await act(async () => {
      await kernel.selectQuick('timestamp');
    });

    await waitFor(() => expect(screen.getByTestId('last-quick-id')).toHaveTextContent('timestamp'));
  });

  it('does not let an older async refresh overwrite a newer snapshot', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstSnapshot = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const snapshots = [
      Promise.resolve({ lastQuickModuleId: 'base64' }),
      firstSnapshot.then(() => ({ lastQuickModuleId: 'base64' })),
      Promise.resolve({ lastQuickModuleId: 'timestamp' }),
    ];
    const listeners = new Set<() => void>();
    const fakeKernel = {
      setup: () => Promise.resolve(),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      snapshot: () => snapshots.shift() ?? Promise.resolve({ lastQuickModuleId: 'timestamp' }),
    } as unknown as Kernel;
    render(<SnapshotProbe kernel={fakeKernel} />);
    await waitFor(() => expect(screen.getByTestId('last-quick-id')).toHaveTextContent('base64'));
    act(() => listeners.forEach((listener) => listener()));
    act(() => listeners.forEach((listener) => listener()));
    await waitFor(() => expect(screen.getByTestId('last-quick-id')).toHaveTextContent('timestamp'));
    releaseFirst?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('last-quick-id')).toHaveTextContent('timestamp');
  });

  it('surfaces a setup failure with a working retry path', async () => {
    let failing = true;
    const kernel = createKernel();
    const originalSetup = kernel.setup.bind(kernel);
    const flakyKernel: Kernel = {
      ...kernel,
      setup: () => (failing ? Promise.reject(new Error('storage unavailable')) : originalSetup()),
    };
    render(<SnapshotProbe kernel={flakyKernel} />);

    await waitFor(() => expect(screen.getByTestId('kernel-error')).toBeInTheDocument());

    failing = false;
    act(() => {
      screen.getByTestId('kernel-error').click();
    });

    await waitFor(() => expect(screen.getByTestId('last-quick-id')).toHaveTextContent('base64'));
  });

  it('surfaces a snapshot refresh failure without throwing', async () => {
    let failing = true;
    const kernel = createKernel();
    const originalSnapshot = kernel.snapshot.bind(kernel);
    const flakyKernel: Kernel = {
      ...kernel,
      snapshot: () => (failing ? Promise.reject(new Error('snapshot failed')) : originalSnapshot()),
    };
    render(<SnapshotProbe kernel={flakyKernel} />);

    await waitFor(() => expect(screen.getByTestId('kernel-error')).toBeInTheDocument());

    failing = false;
    act(() => {
      screen.getByTestId('kernel-error').click();
    });

    await waitFor(() => expect(screen.getByTestId('last-quick-id')).toHaveTextContent('base64'));
  });
});
