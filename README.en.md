# ConvTools

<p align="center">
  <strong>A local-first, modular developer toolbox extension for Chrome and Edge.</strong><br>
  <em>Fast, private, and zero-network by design. No trackers, no bloated AI gimmicks, just clean utilitarian developer ergonomics.</em>
</p>

<p align="center">
  <img src="public/icon/128.png" alt="ConvTools Logo" width="80" height="80" />
</p>

<p align="center">
  <a href="#key-features">Features</a> •
  <a href="#module-catalog">Modules</a> •
  <a href="#extension-surfaces">Surfaces</a> •
  <a href="#privacy--security-model">Privacy & Security</a> •
  <a href="#installation">Installation</a> •
  <a href="#module-development">SDK & Extensibility</a> •
  <a href="#ci-and-releases">CI & Releases</a> •
  <a href="#license">License</a> •
  <a href="README.md">简体中文</a>
</p>

---

## Key Features

- **100% Local-First & Zero Telemetry**: All bundled modules execute completely on-device. No telemetry, no remote analytics, no advertising scripts, and zero outbound network calls for bundled conversions.
- **Microkernel & Modular Tool SDK**: Features are isolated into autonomous modules plugged into a minimal core kernel. Modules declare discrete capabilities, translations, surfaces, and selection actions through strict typing.
- **Adaptive Multi-Surface Architecture**: Seamlessly access tools from wherever you work:
  - **Quick Popup**: A lightweight 380px drawer with drag-and-drop sortable tabs and keyboard reordering.
  - **Standalone Workbench**: A desktop-class workspace with instant module filtering, canvas viewports, and per-module historical logs.
  - **Context Selection Overlay**: An unobtrusive floating HUD injected into web pages via Shadow DOM to deliver instant conversions in place.
  - **Centralized Settings**: Full control over internationalization, light/dark themes, permission audits, and storage purging.
- **Utilitarian Ergonomics**: Refined typography, high-contrast system-native fonts, compact 26–30px controls, proportional icon-to-font sizing, and zero distracting animations or oversized elements.
- **Web Worker Offloading**: CPU-intensive operations (50 MB Base64 chunk streaming, 2× share-card canvas rendering) run in cancellable Web Workers to keep the browser UI responsive.

---

## Module Catalog

ConvTools comes bundled with three production modules:

| Module ID | Module Name | Primary Capabilities | Entry Surfaces | Selection Action | Web Worker | Added Permissions |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| **`base64`** | **Base64** | Text/Data-URL encoding & decoding, tolerant padding repair, streaming file processing (up to 50 MB) | Popup, Workbench | `encode`, `decode` | Yes (`50 MB` chunked) | None |
| **`timestamp`** | **Timestamp** | Epoch seconds/ms ⇄ ISO UTC/Local date-time, native Temporal DST resolution, live clock, IANA timezone selector | Popup, Workbench | `convert` | No | None |
| **`share-card`** | **Share Card** | Turns quotes and articles into elegant visual sharing cards with offline QR codes, 3 styles, and 2 aspect ratios | Workbench | `generate` | Yes (`2× PNG` paint) | None |

---

## Deep Dive: Bundled Modules

### 1. Base64 (`base64`)

A resilient Base64 engine engineered for both micro text strings and large binary files.

- **Format Flexibility**: Supports Standard Base64 (RFC 4648), URL-safe Base64 (`-_`), and MIME-aware Data URLs.
- **Tolerant vs. Strict Modes**:
  - *Tolerant mode* automatically strips extraneous whitespace, normalizes URL-safe characters, and fixes truncated padding (`=`) while providing clear, localized correction notices.
  - *Strict mode* enforces canonical Base64 standards and rejects malformed inputs without silent fixes.
- **Chunked File Streaming**: Encodes and decodes files up to **50 MB** using a dedicated Web Worker. Features real-time progress percentage, memory-safe chunking, and instant task cancellation.
- **Safe Binary Guidance**: Detects binary outputs and offers direct `.bin` downloads rather than blindly guessing file extensions from magic numbers.

### 2. Timestamp (`timestamp`)

A precision timestamp converter powered exclusively by the modern ECMAScript native `Temporal` API.

- **Bidirectional Conversion**: Converts Unix timestamps (seconds / milliseconds) to ISO 8601 UTC and local date-time strings, and vice versa.
- **Intelligent Unit Detection**: Automatically determines whether a timestamp represents seconds or milliseconds based on digit count and reasonable epoch ranges. Flags ambiguous values with explicit prompts.
- **Native Daylight Saving Time (DST) Handling**: When converting local dates in repeated fallback hours, prompts the user to select the earlier or later offset instead of silently misinterpreting time.
- **Live Clock Status**: Displays a live, synchronized clock with a one-click "Use Current Time" autofill button.
- **Global Timezone Picker**: Full IANA timezone database with instant keyword search and browser timezone detection.

### 3. Share Card (`share-card`)

Inspired by clean editorial quote-card aesthetics, this module transforms text into publication-ready image cards.

- **3 Handcrafted Templates**:
  - `Paper` (素笺): Clean, warm minimalist off-white with refined typography.
  - `Ink` (墨岩): High-contrast, dark slate theme for modern feeds.
  - `Mist` (雾蓝): Soft, calming cyan-slate theme with gentle accents.
- **2 Aspect Ratios**: `3:4 Portrait` (optimized for mobile sharing and stories) and `1:1 Square` (optimized for avatars and square feeds).
- **100% Offline QR Codes**: Encodes the source webpage link into an offline vector QR code (powered by `qrcode-generator`) so readers can easily scan and navigate to the original article.
- **Automatic Metadata Extraction**: Reads `document.title`, `meta[name=description]`, `og:title`, and `og:site_name` from the host tab via `activeTab` and `scripting`.
- **High-DPI 2× Export**: Renders up to 2160×2880 px through an `OffscreenCanvas` Web Worker. Supports direct one-click copying to the clipboard (`image/png`) with seamless file-download fallback.

---

## Extension Surfaces

```text
┌─────────────────────────────────────────────────────────────┐
│                      ConvTools Core                         │
└──────┬───────────────┬──────────────────┬──────────────┬────┘
       │               │                  │              │
       ▼               ▼                  ▼              ▼
┌──────────────┐┌──────────────┐┌───────────────────┐┌──────────────┐
│  Popup App   ││  Workbench   ││ Selection Overlay ││ Options App  │
│ (Compact 380)││  (Workspace) ││   (Shadow DOM)    ││  (Settings)  │
└──────────────┘└──────────────┘└───────────────────┘└──────────────┘
```

1. **Popup Window (`PopupApp`)**:
   - Compact 380px viewport tailored for quick conversions on the fly.
   - Smooth drag-and-drop tab reordering powered by `@dnd-kit`, plus full keyboard navigation (`Move Left` / `Move Right`).
   - Dynamically add or remove quick modules; persistent tab state restoration.

2. **Workbench (`WorkbenchApp`)**:
   - Full-tab, distraction-free environment for intensive developer workflows.
   - 15rem sticky sidebar with instantaneous keyword filtering.
   - Module history viewer with record inspection, item removal, and full history wipe.
   - External session hand-off receiver for selection actions.

3. **Selection Overlay (`SelectionOverlay`)**:
   - Injected into web pages upon triggering a context-menu action.
   - Isolated inside an open **Shadow DOM** to guarantee host-page CSS cannot break extension styling, and extension CSS cannot leak into host pages.
   - Compact, content-hugging HUD card that positions intelligently near the selection while staying within viewport bounds.
   - One-click copy with visual confirmation ("Copied!"), dismissed instantly via `Escape` or clicking outside.

4. **Options & Settings (`OptionsApp`)**:
   - Global locale toggle: Auto (match browser), English, or 简体中文.
   - Theme preference: System, Light, or Dark.
   - Default fallback timezone selection.
   - Granular module controls: Enable/disable, revoke optional permissions, clear module history, or "Disable and delete all data".

---

## Privacy & Security Model

ConvTools is engineered with privacy and security as first-class constraints:

- **Strict Minimal Permissions**:
  - `storage`: For storing extension preferences, quick module ordering, and local settings.
  - `contextMenus`: For creating right-click actions on text selections.
  - `activeTab` & `scripting`: Temporary page access is used only after an explicit user context-menu click to read metadata or inject the Shadow DOM overlay.
  - **Banned Permissions**: Never requests `<all_urls>`, `tabs`, permanent background clipboard, or `unlimitedStorage`.
- **Incognito Isolation**:
  - In private/incognito browsing windows, all writes to persistent storage (`storage.local`, IndexedDB) are strictly prohibited.
  - Settings changes remain as an in-memory overlay only; history recording is completely disabled.
- **Local Quota-Capped History**:
  - History is **disabled by default** and must be explicitly opted into.
  - Stored strictly in on-device IndexedDB, hard-capped at **500 entries per module** and **5 MB globally**.
  - For files, history records **metadata only** (file name, byte size, MIME type, action, timestamp); file contents and Base64 payloads are never written to disk.
- **Shadow DOM Isolation**:
  - Injected overlays run in Shadow DOM with reset `:host { all: initial; }` styling, preventing extension and host-page CSS from bleeding across the boundary.

---

## Browser Requirements

| Browser | Minimum Version | Note |
| :--- | :---: | :--- |
| **Google Chrome** | **≥ 144** | Native ECMAScript `Temporal` API support |
| **Microsoft Edge** | **≥ 144** | Native ECMAScript `Temporal` API support |

> *Note*: The extension manifest strictly declares `"minimum_chrome_version": "144"` because the timestamp module relies on standard native `Temporal` primitives without polyfill bloat.

---

## Installation

### From Source (Manual Unpacked)

1. **Prerequisites**: Ensure you have Node.js `22.14.0` (or newer 22.x) and `pnpm` `11.21.0` installed.
2. **Clone and install**:
   ```bash
   git clone https://github.com/CyberKurry/ConvTools.git
   cd ConvTools
   pnpm install --frozen-lockfile
   ```
3. **Build the extension**:
   ```bash
   # Build for Chrome
   pnpm build:chrome

   # Or build for Microsoft Edge
   pnpm build:edge
   ```
4. **Load into your browser**:
   - Navigate to `chrome://extensions` (or `edge://extensions`).
   - Enable **Developer mode** (toggle in the top-right or sidebar).
   - Click **Load unpacked** and select the `.output/chrome-mv3` (or `.output/edge-mv3`) folder.

---

## Module Development

ConvTools features an automated module generation and validation workflow.

### Adding a New Module

To scaffold a new module skeleton conforming to the architecture:

```bash
pnpm module:add <module-id>
```

This generates a directory under `modules/<module-id>` containing `module.json`, unit tests, dual-language locale dictionaries (`en.json`, `zh_CN.json`), and default icons.

### Removing a Module

```bash
pnpm module:remove <module-id>
```

Safely validates and deletes an uncommitted module while updating registration files.

### Static Code Generation

```bash
pnpm generate
```

Scans the `modules/` directory and emits `generated/module-registry.ts` and `generated/module-manifest.ts`.

---

## Engineering Standards & Commands

ConvTools enforces automated quality gates:

```bash
# Code Quality
pnpm lint               # ESLint with strict React hooks and a11y rules
pnpm typecheck          # TypeScript strict mode verification

# Testing
pnpm test               # Run all unit, integration, and build-gate tests
pnpm test:unit          # Run unit test suite
pnpm test:e2e           # Run Playwright end-to-end tests in headless Chromium

# Artifacts & Auditing
pnpm build:chrome       # Build Chrome MV3 production bundle
pnpm build:edge         # Build Microsoft Edge MV3 production bundle
pnpm manifest:audit     # Validate MV3 manifests against permission security policies
pnpm icons:check        # Ensure PNG icons match source vector assets

# Aggregate Gate
pnpm check              # Comprehensive pre-commit hard gate running all checks
```

### CI and Releases

- GitHub Actions runs a frozen install, sets up Chromium, and runs `pnpm check` on pushes to `main` and pull requests targeting `main`.
- After a `main` push passes verification, the workflow assigns the commit a version, builds and audits the Chrome and Edge extensions, and publishes both ZIP files to GitHub Releases. The first release uses the version in `package.json`, and later releases increment the patch number by default. Retrying a release reuses the commit's existing tag.

---

## Technology Stack

- **Framework**: [WXT](https://wxt.dev/) (Next-gen Web Extension Framework) + [React 19](https://react.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict Mode)
- **Styling**: CSS Modules + Zero-Runtime Design Tokens
- **Interactions**: [@dnd-kit](https://dndkit.com/) for fluid, accessible drag-and-drop
- **Testing**: [Vitest](https://vitest.dev/) (Unit/Integration) + [Playwright](https://playwright.dev/) (MV3 Extension E2E)
- **Utilities**: Native `Temporal` API, `qrcode-generator` (pure offline mathematics)

---

## License

This project is licensed under the [MIT License](LICENSE).

ConvTools source code and design assets are free for commercial and personal use. All icon vectors and typography stacks rely exclusively on royalty-free system assets.
