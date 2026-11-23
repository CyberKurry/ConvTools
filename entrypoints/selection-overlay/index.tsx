import { createElement } from 'react';
import { createRuntimeMessageClient } from '../../core/messaging/runtime-client';
import type { ConvToolsMessages } from '../../core/messaging/messages';
import { createRoot, type Root } from 'react-dom/client';
import { FALLBACK_OVERLAY_LABELS, type OverlayPayload } from '../../core/registry/overlay-payload';
import { SelectionOverlay } from './SelectionOverlay';
import selectionOverlayStyles from './SelectionOverlay.module.css?inline';
import tokensStyles from '../../core/theme/tokens.css?inline';

declare global {
  interface Window {
    __CONVTOOLS_OVERLAY__?: OverlayPayload;
    __CONVTOOLS_OVERLAY_ACTIVE__?: { root: Root; host: HTMLDivElement };
  }
}

function overlayCss(): string {
  return `
    :host { all: initial; }
    .convtools-overlay-mount {
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
    }
  `;
}

// The bundled script re-evaluates on every injection, so module-level state is
// per-instance: keeping the active mount on window lets a second injection
// close and replace the first overlay instead of stacking both.
function getActive(): { root: Root; host: HTMLDivElement } | null {
  return window.__CONVTOOLS_OVERLAY_ACTIVE__ ?? null;
}

function setActive(next: { root: Root; host: HTMLDivElement } | null): void {
  if (next) {
    window.__CONVTOOLS_OVERLAY_ACTIVE__ = next;
  } else {
    delete window.__CONVTOOLS_OVERLAY_ACTIVE__;
  }
}

function closeActive(): void {
  const active = getActive();
  if (!active) {
    return;
  }
  setActive(null);
  active.root.unmount();
  active.host.remove();
  delete window.__CONVTOOLS_OVERLAY__;
}

export default defineUnlistedScript(() => {
  mount();
});

// Expansion rides the typed message bus instead of a hand-shaped payload.
// Built lazily: the module may load in test contexts without the runtime.
let client: ReturnType<typeof createRuntimeMessageClient<ConvToolsMessages>> | null = null;
function messageClient() {
  client ??= createRuntimeMessageClient<ConvToolsMessages>(browser.runtime);
  return client;
}

function mount(): void {
  // Capture the new payload before closing the old mount. closeActive clears
  // the global handoff, so reading it afterwards would lose a rapid second
  // injection and render the fallback payload instead.
  const payload = window.__CONVTOOLS_OVERLAY__ ?? {
    result: '',
    actionLabel: '',
    labels: FALLBACK_OVERLAY_LABELS,
  };
  closeActive();

  const host = document.createElement('div');
  host.id = 'convtools-overlay-root';
  // Follow the resolved extension preference when provided; otherwise follow
  // the OS scheme. tokens.css carries the dark host variant.
  const theme = payload.theme ?? (
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  );
  host.dataset.theme = theme;
  const shadow = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);

  const style = document.createElement('style');
  style.textContent = `${tokensStyles}\n${selectionOverlayStyles}\n${overlayCss()}`;
  shadow.appendChild(style);

  const mountRoot = document.createElement('div');
  mountRoot.className = 'convtools-overlay-mount';
  shadow.appendChild(mountRoot);

  const root = createRoot(mountRoot, {
    // A render crash must not leave the injected host behind: without this
    // hook the React tree is dead, the Escape/outside-click effects never
    // mount, and the Shadow DOM node would stay on the page until a reload
    // (spec §16 requires the overlay root, listeners and observers to be
    // removed once the overlay is done).
    onUncaughtError: () => {
      closeActive();
    },
  });
  setActive({ root, host });
  // The origin action narrows only when both fields are present, which is
  // exactly when the overlay offers Expand at all.
  const originAction =
    typeof payload.moduleId === 'string' && typeof payload.actionId === 'string'
      ? { moduleId: payload.moduleId, actionId: payload.actionId }
      : null;
  root.render(
    createElement(SelectionOverlay, {
      result: payload.result,
      actionLabel: payload.actionLabel,
      isError: payload.isError === true,
      labels: payload.labels ?? FALLBACK_OVERLAY_LABELS,
      canExpand: originAction !== null,
      onClose: closeActive,
      onExpand: () => {
        // window.open of a chrome-extension:// page is blocked in MV3 content
        // contexts (no web_accessible_resources by design), so expansion goes
        // through the background, which re-stores the payload and opens a tab.
        // The typed message keeps the payload contract checked; resolving
        // false lets the overlay tell the user instead of looking like a dead
        // button.
        if (!originAction) {
          return Promise.resolve(false);
        }
        return messageClient()
          .request('CONVTOOLS_HANDOFF_OPEN', { ...originAction, result: payload.result })
          .then((response) => {
            if (response.ok) {
              closeActive();
              return true;
            }
            return false;
          })
          .catch(() => false);
      },
    }),
  );
}


