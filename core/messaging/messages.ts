import type { MessageClient } from './client';
import type { MessageMap } from './protocol';
import type { HandoffPayload } from '../handoff/session-handoff';

/**
 * The typed message table shared by every extension context (spec §6.2 "类型
 * 消息总线"). The background attaches a router to these; senders use the
 * typed client so payloads and responses are checked at compile time instead
 * of being hand-sniffed field by field.
 *
 * Notes on the members:
 * - HANDOFF_CONSUME: the workbench redeems a one-time fallback payload.
 * - HANDOFF_OPEN: the overlay's Expand re-stores a payload and opens a tab
 *   (MV3 blocks window.open of chrome-extension:// from content contexts).
 * - TEST_SHOW_OVERLAY: e2e-only trigger; Playwright cannot drive the native
 *   context-menu gesture. Compiled out of production builds.
 */
export interface ConvToolsMessages extends MessageMap {
  CONVTOOLS_HANDOFF_CONSUME: {
    request: { readonly token: string };
    response: { readonly payload: HandoffPayload | null };
  };
  CONVTOOLS_HANDOFF_OPEN: {
    request: { readonly moduleId: string; readonly actionId: string; readonly result: string };
    response: { readonly ok: boolean };
  };
  CONVTOOLS_TEST_SHOW_OVERLAY: {
    request: { readonly moduleId: string; readonly actionId: string; readonly selectionText: string };
    response: { readonly ok: boolean };
  };
}

export type ConvToolsMessageClient = MessageClient<ConvToolsMessages>;
