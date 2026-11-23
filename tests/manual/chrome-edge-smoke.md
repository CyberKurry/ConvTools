# Chrome / Edge manual smoke checklist

Run this against both `.output/chrome-mv3` and `.output/edge-mv3` in the
matching browser (Chrome 144+ / Edge 144+).

## Install

- [ ] Enable Developer mode and load the unpacked extension.
- [ ] Confirm the extension icon appears with no install error.

## Popup

- [ ] Click the action icon; the popup shows Base64 then Timestamp quick tabs.
- [ ] The strip scrolls horizontally when overflowing.
- [ ] The last-used module is restored after reopening.
- [ ] Add/remove quick modules and confirm the order persists.
- [ ] Drag tabs with a pointer and reorder with keyboard controls.
- [ ] Open workbench and settings from the popup links.

## Workbench

- [ ] The sidebar lists enabled modules and supports search.
- [ ] Selecting a module loads its surface; the URL hash updates.
- [ ] Refreshing restores the selected module.
- [ ] Navigating to an unknown hash shows the fallback.
- [ ] A module crash is isolated behind an error card with a retry.

## Base64

- [ ] Text encode/decode round-trips ASCII, Chinese, and emoji (UTF-8).
- [ ] URL-safe alphabet and Data URL encode/decode work.
- [ ] Tolerant mode shows a correction summary; strict mode rejects.
- [ ] Swap, clear, copy fallback, and text download work.
- [ ] File over 50 MB is rejected before reading.
- [ ] A valid file encodes with progress and can be cancelled.
- [ ] Decoding a non-text payload shows the `.bin` download path.

## Timestamp

- [ ] Seconds and milliseconds convert to ISO UTC and both epoch values.
- [ ] Date-to-timestamp works in the browser zone and UTC.
- [ ] Current time updates live and "use current time" freezes a moment.
- [ ] A DST nonexistent time shows an error; a repeated time asks for an offset.
- [ ] Timezone search lists UTC and the browser zone first.

## Selected-text overlay

- [ ] Selecting text and using the context menu opens the overlay.
- [ ] Copy, expand, close, Escape, and outside-click all work.
- [ ] On `chrome://` or a store page, results fall back to the workbench.

## History

- [ ] History is off by default.
- [ ] Enabling history records text (and file metadata only) locally.
- [ ] Per-module and global clear work.

## Incognito

- [ ] In an incognito window (split mode), conversions work.
- [ ] No history, input/result, or send-policy data is persisted.

## Settings

- [ ] Enable/disable modules; disabling preserves data.
- [ ] "Disable and delete data" removes a module's local data.
- [ ] Language (auto/zh/en), theme (system/light/dark), and timezone persist.
- [ ] Quick-module order edits persist and sync keys make sense.

## Permissions

- [ ] The manifest contains only `storage`, `contextMenus`, `activeTab`, and
  `scripting`, with no `<all_urls>` or clipboard/unlimited-storage permissions.