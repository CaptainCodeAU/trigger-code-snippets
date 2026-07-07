# trigger-code-snippets

> **Status: As-built.** This document describes the shipped **v1.0.0** implementation and was verified against the source on 2026-05-30 — the code matches this spec apart from the minor, explicitly-marked notes inline below. The **"Future Considerations (v2+)"** section is a roadmap and is **not** yet implemented.

## Overview

A Chrome extension that lets users save JavaScript code snippets, assign keyboard shortcuts to them, and run them on specific web pages. Snippets execute in the page's main JavaScript context using the Chrome DevTools Protocol (`chrome.debugger` API), behaving like Chrome DevTools snippets but triggered via positional keyboard shortcuts, the toolbar popup, or the right-click context menu.

Personal-use tool. Chrome only. No publishing to the Chrome Web Store.

---

## Core Features

### 1. Snippet Management

- Users can create, edit, delete, and **reorder** up to **100 snippets**.
- Each snippet has:
  - **Name** (required) — a short label for identification.
  - **Code** (required) — JavaScript code, entered in a plain `<textarea>` with a **line number gutter**.
  - **Positional keyboard shortcut** (automatic) — the first 9 snippets are assigned `Alt+Shift+1` through `Alt+Shift+9` based on their list position. Snippets at position 10+ have no keyboard shortcut.
  - **Allowed URLs** (required) — one or more wildcard match patterns defining which pages the snippet is allowed to run on. Snippets will **not** run if the current page URL does not match any of the specified patterns.
  - *Note: "required" fields are guidance, not hard-enforced. The manager validates URL patterns and flags malformed ones, but does not block saving a snippet with an empty name or an empty URL list. A snippet with no valid URL pattern simply never runs (silent no-op).*
- All snippet data is stored in **Chrome extension storage** (`chrome.storage.local`).
- Changes are **auto-saved** with an 800ms debounce. A visual indicator shows "Saving..." → "Auto-saved ✓" → fades out.

### 2. Keyboard Shortcuts

- **Positional shortcuts only**: `Alt+Shift+1` through `Alt+Shift+9`, fixed to list position.
- Implemented via a content script (`content.js`) that listens for `keydown` events in the capture phase using `e.code` (physical key, layout-independent).
- The content script sends a message to the background service worker, which handles lookup and execution.
- **Drag-to-reorder** snippets in the manager to reassign which shortcut triggers which snippet.
- If the current page URL does not match the snippet's allowed URLs, the shortcut does nothing (silent no-op).

### 3. Toolbar Popup (Left-Click Extension Icon)

- **Left-clicking** the extension icon opens a **popup** with a list of all snippets (up to 100 shown).
- Each snippet shows its name; the first 9 also display a shortcut badge (`Alt+Shift+N`).
- Snippets matching the current page URL are **clickable** — clicking one executes it immediately.
- Non-matching snippets are **greyed out** (disabled, `pointer-events: none`, reduced opacity).
- An empty state shows a link to open the manager page.
- The popup is dark themed (320px wide, max 480px tall, scrollable).

### 4. Right-Click Context Menu (On Web Page)

- A context menu group labelled **"Trigger Code Snippets"**.
- Each saved snippet appears as a sub-item, with shortcut hints for the first 9 (e.g., `Snippet Name [Alt+Shift+1]`).
- Non-matching snippets are **greyed out (disabled)**, not hidden — this follows Chrome conventions for discoverability.
- Context menu states (enabled/disabled) are updated dynamically when the active tab changes or navigates, via `chrome.tabs.onActivated` and `chrome.tabs.onUpdated` listeners.
- Context menus are rebuilt (with a 500ms debounce) whenever snippets change in storage.

### 5. Script Execution

- All snippets execute in the **page's main JavaScript context** using the **Chrome DevTools Protocol** via `chrome.debugger` API.
- Execution flow: `chrome.debugger.attach()` → `Runtime.evaluate({ expression, userGesture: true })` → `chrome.debugger.detach()`.
- This approach **bypasses all CSP restrictions** including `unsafe-eval` blocks and Trusted Types policies (e.g., YouTube), behaving identically to code run in Chrome DevTools.
- A brief "Extension is debugging this browser" banner appears each time a snippet executes. This is a Chrome security requirement for the `debugger` API and cannot be suppressed from the extension. It can be hidden by launching Chrome with the `--silent-debugger-extension-api` flag.
- Execution is fire-and-forget — no return value handling needed.

### 6. URL Restrictions

- Each snippet requires at least one allowed URL pattern.
- Patterns use **Chrome match pattern** syntax:
  - `*://example.com/*` — matches any protocol on example.com.
  - `https://*.google.com/*` — matches any Google subdomain over HTTPS.
  - `*://*/*` — matches all URLs (user can set this for a global snippet).
- Multiple patterns can be specified per snippet (one per line in a multi-line textarea).
- Validation: the management page shows inline error messages for malformed patterns.
- Pattern matching is implemented by converting Chrome match patterns to RegExp at runtime (in `shared/storage.js`).

### 7. Import / Export

- **Export**: Downloads a single JSON file (`trigger-code-snippets-export.json`) containing all snippets. Internal fields (`id`, `position`) are stripped — only `name`, `code`, and `allowedUrls` are exported.
- **Import**: User picks a JSON file via a file input. A styled dialog offers three options:
  - **Replace all** — wipes existing snippets, loads imported ones with new IDs and positions.
  - **Append to existing** — adds imported snippets after existing ones. Duplicate names are resolved by appending `(2)`, `(3)`, etc.
  - **Cancel** — dismisses the dialog.
- Import validates the JSON schema: must be an array of objects, each with `name` (non-empty string), `code` (string), and `allowedUrls` (array).
- Handles large snippets (60KB+ individual files) — `chrome.storage.local` has a ~5MB default quota. *Caveat: the entire snippet array is rewritten on every auto-save and there is currently no storage-quota error handling, so approaching the quota would fail silently (the save indicator would still show "Auto-saved ✓").*

### 8. Default Snippets (First Install)

- On first install (`chrome.runtime.onInstalled` with `reason === 'install'`), 16 default snippets are loaded from `defaults/default-snippets.json`.
- Defaults are sourced from the [CaptainCodeAU/devtools-snippets](https://github.com/CaptainCodeAU/devtools-snippets) GitHub repository. *Note: the bundled `default-snippets.json` was re-synced to upstream on 2026-05-30 (commit `2736ce3`) — retired entries (Web Page Inspector v1, AI Studio DOM Inspectors) were dropped and newer snippets (Claude.ai Chat Exporter, YouTube Playback Speed) added. It remains a point-in-time snapshot; re-sync again if upstream moves ahead.*
- Each default snippet has pre-configured URL patterns based on its purpose:
  - General utilities (`*://*/*`): Clear Site Data & Cache, Download All Resources, Font Downloader, HTML to PDF, Resource Analyzer, Web Page Inspector v2, Batch URL downloader.
  - Google AI Studio (`*://aistudio.google.com/*`): Chat Exporter (Base64), Chat Exporter (Separate), Library Exporter.
  - Claude.ai (`*://*.claude.ai/*`): Chat Exporter.
  - n8n (`*://*.n8n.io/*`): n8n Component Inspector, Cleanup & Reveal Workflow.
  - Patreon (`*://*.patreon.com/*`): Load Comments & Fix.
  - Prime Video (`*://*.primevideo.com/*`, `*://*.amazon.com/*`): Playback Speed.
  - YouTube (`*://*.youtube.com/*`): Playback Speed.
- Defaults are **only loaded on first install** — reloading or updating the extension does not overwrite existing snippets. A `initialized` flag in `chrome.storage.local` prevents re-loading.

---

## UI — Full Tab Management Page

### General

- Opens as a **full browser tab** via the extension's **options page** (accessible by right-clicking the extension icon → "Options").
- **Dark theme** throughout — sophisticated, polished, clean design with good spacing and subtle transitions.
- The design uses a CSS custom property system for consistent theming.

### Layout

- **Toolbar** (top bar):
  - Left: ⚡ logo and "Trigger Code Snippets" title.
  - Right: Auto-save indicator, Import button, Export button, "+ New Snippet" button.
- **Sidebar** (left panel, default 400px, resizable 200–600px via drag handle):
  - Header with "Snippets" label and count badge.
  - Scrollable list of snippets, each showing:
    - Drag handle (`≡`) for reordering.
    - Position number (1–9 highlighted in accent color with shortcut badge, 10+ in muted color).
    - Snippet name (truncated with ellipsis if too long).
    - Shortcut hint (`Alt+Shift+N`) for positions 1–9.
  - Active snippet highlighted with accent-colored left border.
  - HTML5 native drag-and-drop for reordering (no external libraries).
- **Editor panel** (right side):
  - Placeholder state: ⚡ icon with "Select a snippet to edit" message.
  - When a snippet is selected:
    - **Name** input field.
    - **URL Patterns** textarea (monospace font, one pattern per line) with inline validation messages.
    - **Code** textarea (monospace font, 500px fixed height) with a **line number gutter** that syncs scroll position.
    - **Delete Snippet** button (danger-styled, triggers browser `confirm()` dialog).
  - Tab key in the code textarea inserts 2 spaces instead of changing focus.

### Resizable Sidebar

- A drag handle on the sidebar's right edge allows resizing between 200px and 600px.
- The handle is invisible by default, turns accent-colored on hover.
- During resize, `cursor: col-resize` is applied to the body and text selection is disabled.

### Import Dialog

- Styled modal overlay (dark themed, centered, rounded) — not a browser dialog.
- Shows the number of snippets being imported with Replace / Append / Cancel buttons.
- Dismissible by clicking the overlay background.

### No Run Button

- The management page is for editing only. Snippets are triggered exclusively via keyboard shortcuts, the toolbar popup, or the context menu.

---

## Technical Details

### Manifest

- **Manifest V3**.
- Permissions: `activeTab`, `scripting`, `contextMenus`, `storage`, `debugger`. *Note: `scripting` is declared but currently unused — all execution goes through `chrome.debugger` (see Architecture Notes). The permission is vestigial and could be removed.*
- Host permissions: `<all_urls>`.
- Background: **module** service worker (`background.js`).
- Content scripts: `content.js` on `<all_urls>` at `document_start`.
- The management page registered as `options_page`.
- Toolbar popup registered as `default_popup`.

### Storage Schema

```json
{
  "snippets": [
    {
      "id": "uuid",
      "name": "My Snippet",
      "code": "console.log('hello');",
      "allowedUrls": [
        "https://*.example.com/*"
      ],
      "position": 0
    }
  ],
  "initialized": true
}
```

### File Structure

```
trigger-code-snippets/
├── manifest.json
├── background.js          # Service worker (ES module): handles context menus,
│                          # debugger-based script execution, message routing,
│                          # first-install defaults, storage change listeners
├── content.js             # Content script (IIFE): listens for Alt+Shift+1-9
│                          # keydown events, sends messages to background
├── shared/
│   └── storage.js         # ES module: CRUD operations, URL pattern matching
│                          # (match pattern → RegExp), import/export with
│                          # deduplication, schema validation
├── popup/
│   ├── popup.html         # Toolbar popup page
│   ├── popup.css          # Dark theme popup styles
│   └── popup.js           # ES module: lists snippets, click-to-execute
├── manager/
│   ├── manager.html       # Full-tab management/options page
│   ├── manager.css        # Dark theme styles with CSS custom properties
│   └── manager.js         # ES module: snippet CRUD, auto-save with debounce,
│                          # drag-and-drop reorder, import/export UI,
│                          # line number gutter, sidebar resize, URL validation
├── defaults/
│   └── default-snippets.json  # 16 pre-loaded snippets from GitHub repo
├── icons/
│   ├── icon16.png         # ⚡ lightning bolt on dark navy background
│   ├── icon48.png         # (generated via Node.js canvas script)
│   └── icon128.png
└── docs/
    └── SPEC.md            # This specification
```

### Architecture Notes

- **No external libraries** — pure vanilla JS, HTML5 drag-and-drop, no build step.
- **ES modules** for `background.js`, `popup.js`, and `manager.js` (imported via `<script type="module">`). `content.js` is a standalone IIFE (content scripts cannot use ES modules).
- **Service worker is stateless** — always reads from `chrome.storage.local`, never caches in module-level variables. This handles Chrome's service worker lifecycle (idle termination/restart).
- **Script execution via `chrome.debugger`** — the only reliable method for executing arbitrary user-defined JavaScript on pages with strict CSP (e.g., YouTube's Trusted Types and `unsafe-eval` blocks). `chrome.scripting.executeScript` with `world: 'MAIN'` cannot evaluate dynamic code strings on CSP-restricted pages.
- **Message passing**: Content script → background (`execute-by-position`), popup → background (`execute-by-id`). The background listener returns `true` for async response handling, and calls `sendResponse` when done, ensuring the popup doesn't close before execution completes.
- **Context menu state management**: All menu items are created as `enabled: false` by default, then updated per-tab via `chrome.contextMenus.update()` based on URL matching. This achieves the "greyed out" behavior rather than hiding non-matching items.

### Design System (CSS)

| Token | Value | Usage |
|---|---|---|
| `--bg-primary` | `#0d1117` | Page background |
| `--bg-secondary` | `#161b22` | Sidebar, toolbar, inputs |
| `--bg-tertiary` | `#21262d` | Cards, active states |
| `--border` | `#30363d` | Borders |
| `--text-primary` | `#e6edf3` | Body text |
| `--text-secondary` | `#8b949e` | Labels |
| `--text-muted` | `#6e7681` | Hints, line numbers |
| `--accent` | `#58a6ff` | Active elements, focus rings |
| `--danger` | `#f85149` | Delete button, validation errors |
| `--success` | `#3fb950` | Save indicator |

---

## Icons

- **Lightning bolt (⚡)** on a dark navy background (`#1a1a2e` → `#16213e` gradient) with rounded corners.
- Yellow-to-orange gradient bolt color (`#FFD60A` → `#FFAA00`).
- Generated programmatically using a Node.js script (`generate-icons.js`) that produces raw PNGs at 16px, 48px, and 128px using `zlib` for PNG compression. The script is **not included in this repository** — it was run once externally to produce the committed icon files (`icons/icon16.png`, `icon48.png`, `icon128.png`).

---

## Out of Scope for v1

- Syntax highlighting / code editor (CodeMirror, Monaco, etc.).
- Firefox or other browser support.
- Success / error notifications after execution.
- Console logging integration.
- Chrome Web Store publishing.
- Custom keyboard shortcut recording (shortcuts are positional only).
- Suppressing the debugger banner from within the extension (requires Chrome launch flag).

---

## Future Considerations (v2+)

- Syntax-highlighted code editor (CodeMirror or Monaco).
- Success / error toast notifications after snippet execution.
- Cross-browser support (Firefox via `browser.*` APIs).
- Snippet grouping / folders.
- Snippet execution history / logs.
- Search / filter snippets in the sidebar.
- Snippet templates / starter code.
