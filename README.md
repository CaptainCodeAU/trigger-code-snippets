# Trigger Code Snippets

A Chrome extension for saving and running JavaScript code snippets on web pages via keyboard shortcuts, the toolbar popup, or the right-click context menu. Snippets execute in the page's main JavaScript context using the Chrome DevTools Protocol, bypassing all CSP restrictions.

Personal-use tool. Not published to the Chrome Web Store.

## Features

- **Up to 100 snippets** with name, code, and URL pattern restrictions
- **Keyboard shortcuts** — `Alt+Shift+1` through `Alt+Shift+9` for the first 9 snippets, based on list position
- **Toolbar popup** — left-click the extension icon to see and execute snippets
- **Context menu** — right-click on any page to trigger snippets
- **Drag-to-reorder** — reorder snippets to change shortcut assignments
- **Auto-save** — changes persist automatically
- **Import/Export** — bulk backup and restore snippets as JSON
- **URL restrictions** — each snippet only runs on matching pages (Chrome match patterns)
- **CSP bypass** — executes via `chrome.debugger`, working on strict sites like YouTube
- **Dark theme** management page with resizable sidebar and line numbers
- **16 default snippets** pre-loaded from [CaptainCodeAU/devtools-snippets](https://github.com/CaptainCodeAU/devtools-snippets)

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `trigger-code-snippets` folder

## Usage

| Action | How |
|---|---|
| Execute a snippet | `Alt+Shift+1`–`9`, or left-click extension icon and select, or right-click page context menu |
| Manage snippets | Right-click extension icon → **Options** |
| Reorder snippets | Drag snippets up/down in the manager sidebar |
| Import snippets | Click **Import** in the manager toolbar, select a JSON file |
| Export snippets | Click **Export** in the manager toolbar |

### URL Patterns

Each snippet requires at least one URL pattern (Chrome match pattern syntax):

```
*://*/*              — all pages
*://example.com/*    — any protocol on example.com
https://*.google.com/* — any Google subdomain over HTTPS
```

### Debugger Banner

When a snippet executes, Chrome briefly shows a "started debugging this browser" banner. This is a Chrome security requirement for the `chrome.debugger` API. To suppress it, launch Chrome with:

```
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --silent-debugger-extension-api
```

## Project Structure

```
trigger-code-snippets/
├── manifest.json          # MV3 manifest
├── background.js          # Service worker: execution, context menus, messaging
├── content.js             # Keyboard shortcut listener (Alt+Shift+1-9)
├── shared/
│   └── storage.js         # Storage CRUD, URL matching, import/export
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js           # Toolbar popup: snippet list, click-to-execute
├── manager/
│   ├── manager.html
│   ├── manager.css
│   └── manager.js         # Management page: CRUD, drag reorder, auto-save
├── defaults/
│   └── default-snippets.json  # 16 pre-loaded snippets
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── docs/
    └── SPEC.md            # Full specification
```

## Import/Export Format

Snippets are exported as a JSON array:

```json
[
  {
    "name": "My Snippet",
    "code": "console.log('hello');",
    "allowedUrls": ["*://*/*"]
  }
]
```

When importing with **Append**, duplicate names are resolved by appending `(2)`, `(3)`, etc.

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript (no frameworks, no build step)
- ES modules for background, popup, and manager
- `chrome.debugger` API for CSP-safe script execution
- `chrome.storage.local` for persistence
- HTML5 drag-and-drop for reordering

## License

Personal use.
