import { createRuntimeMessageClient } from '../../core/messaging/runtime-client';
import type { ConvToolsMessages } from '../../core/messaging/messages';

export interface ConsumedHandoff {
  readonly moduleId: string;
  readonly result?: string;
  readonly input?: unknown;
}

/**
 * Consumes a one-time `#handoff=<token>` payload from the background.
 *
 * The token is stripped from the URL whichever way the consume ends: a failed
 * or expired token must not survive in browser history, or a later refresh
 * would silently re-request it (and a still-live token could be replayed).
 */
export async function consumeHandoff(token: string): Promise<ConsumedHandoff | null> {
  try {
    // The typed message bus replaces the hand-shaped payload: the response
    // payload keeps the correlation id and the discriminator fields intact.
    const response = await createRuntimeMessageClient<ConvToolsMessages>(
      browser.runtime,
    ).request('CONVTOOLS_HANDOFF_CONSUME', { token });
    const payload = response.payload ?? null;
    if (!payload || typeof payload.moduleId !== 'string') {
      return null;
    }
    return {
      moduleId: payload.moduleId,
      ...(typeof payload.result === 'string' ? { result: payload.result } : {}),
      ...(payload.input !== undefined ? { input: payload.input } : {}),
    };
  } finally {
    stripHandoffHash();
  }
}

/** Removes `#handoff=...` while keeping the rest of the document URL intact. */
export function stripHandoffHash(): void {
  if (/^#handoff=/.test(window.location.hash)) {
    window.history.replaceState(null, '', window.location.pathname);
  }
}
