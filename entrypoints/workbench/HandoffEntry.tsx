import { useEffect, useRef, useState, type ReactElement } from 'react';
import { HandoffResult } from './HandoffResult';
import type { ConsumedHandoff } from './handoff-consume';

export type { ConsumedHandoff };

/**
 * Single entry for `#handoff=<token>` routes. Consumes the token exactly
 * once, then either hands a module input up to the workbench shell (which
 * switches to the editor route) or renders the finished result. Nothing is
 * rendered while the consume is in flight.
 */
export function HandoffEntry(props: {
  readonly token: string;
  readonly consume: (token: string) => Promise<ConsumedHandoff | null>;
  readonly onInput: (moduleId: string, input: unknown) => void;
}): ReactElement | null {
  const consumedTokensRef = useRef<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<
    { kind: 'pending' } | { kind: 'result'; result: string } | { kind: 'missing' }
  >({ kind: 'pending' });
  const mountedRef = useRef(true);
  const effectRunRef = useRef(0);

  useEffect(() => {
    const effectRun = effectRunRef.current + 1;
    effectRunRef.current = effectRun;
    mountedRef.current = true;
    const cleanup = (): void => {
      // React StrictMode runs an effect cleanup immediately before replaying
      // the effect. Deferring the flag lets the replay keep the one in-flight
      // consume alive while still suppressing a real unmount.
      queueMicrotask(() => {
        if (effectRunRef.current === effectRun) {
          mountedRef.current = false;
        }
      });
    };
    if (consumedTokensRef.current.has(props.token)) {
      return cleanup;
    }
    consumedTokensRef.current.add(props.token);
    // A new token replaces the previous payload entirely: without this reset
    // the shell kept rendering the old result until (and unless) the new
    // consume resolved, and the old HandoffResult never re-ran its
    // consume-once guard because its token prop had not changed.
    setOutcome({ kind: 'pending' });
    props
      .consume(props.token)
      .then((payload) => {
        if (!mountedRef.current) {
          return;
        }
        if (payload && payload.input !== undefined) {
          props.onInput(payload.moduleId, payload.input);
          return;
        }
        setOutcome(
          payload && typeof payload.result === 'string'
            ? { kind: 'result', result: payload.result }
            : { kind: 'missing' },
        );
      })
      .catch(() => {
        if (mountedRef.current) {
          setOutcome({ kind: 'missing' });
        }
      });
    return cleanup;
    // The token identifies this fetch; consume must run exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.token]);

  if (outcome.kind === 'pending') {
    return null;
  }
  if (outcome.kind === 'missing') {
    // The cached consume already deleted the token; the view just renders it.
    return <HandoffResult token={props.token} consume={() => Promise.resolve(null)} />;
  }
  const result = outcome.result;
  return <HandoffResult token={props.token} consume={() => Promise.resolve({ result })} />;
}
