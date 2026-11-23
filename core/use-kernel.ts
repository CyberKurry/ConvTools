import { useCallback, useEffect, useState } from 'react';
import type { Kernel, KernelSnapshot } from './kernel';

export interface KernelSnapshotState {
  /** Null while loading or after a failed setup (spec §15: visible failure). */
  readonly snapshot: KernelSnapshot | null;
  /** Set when the initial setup or a refresh failed; retry re-runs it. */
  readonly error: boolean;
  readonly retry: () => void;
}

export function useKernelSnapshot(kernel: Kernel): KernelSnapshotState {
  const [snapshot, setSnapshot] = useState<KernelSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setError(false);
    setAttempt((value) => value + 1);
  }, []);
  useEffect(() => {
    let mounted = true;
    let refreshVersion = 0;
    const refresh = async (): Promise<void> => {
      const version = ++refreshVersion;
      const next = await kernel.snapshot();
      if (mounted && version === refreshVersion) {
        setSnapshot(next);
        setError(false);
      }
    };
    const refreshSafely = (): void => {
      refresh().catch(() => {
        // A failed refresh keeps the last good snapshot on screen but flags
        // the failure so the shell can render a visible retry path.
        if (mounted) {
          setError(true);
        }
      });
    };
    const unsubscribe = kernel.subscribe(refreshSafely);
    void (async () => {
      await kernel.setup();
      await refresh();
    })().catch(() => {
      if (mounted) {
        setError(true);
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [kernel, attempt]);
  return { snapshot, error, retry };
}
