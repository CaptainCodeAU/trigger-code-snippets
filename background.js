import {
  getSnippets, saveSnippets, getSnippetById,
  matchUrl, isInitialized, setInitialized
} from './shared/storage.js';

// Shared by the popup's dropdown (message-based) and the toolbar-icon
// right-click submenu (context-menu-based) so both offer the same 4 choices.
// Grouped by action rather than spelling it out on every item ("Download as
// Markdown File", etc.) -- the group says the verb once, each item is just
// the format, for a much shorter read.
const TAB_URL_MENU_ITEMS = {
  'tcs-download-markdown': { title: 'Markdown', action: 'download', format: 'markdown', group: 'download' },
  'tcs-download-text': { title: 'Text', action: 'download', format: 'text', group: 'download' },
  'tcs-copy-markdown': { title: 'Markdown', action: 'copy', format: 'markdown', group: 'copy' },
  'tcs-copy-text': { title: 'Text', action: 'copy', format: 'text', group: 'copy' }
};

// --- First-run: load default snippets ---

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const alreadyInit = await isInitialized();
    if (!alreadyInit) {
      try {
        const resp = await fetch(chrome.runtime.getURL('defaults/default-snippets.json'));
        const defaults = await resp.json();
        const snippets = defaults.map((s, i) => ({
          id: crypto.randomUUID(),
          name: s.name,
          code: s.code,
          allowedUrls: s.allowedUrls,
          position: i
        }));
        await saveSnippets(snippets);
        await setInitialized();
      } catch (err) {
        console.error('Failed to load default snippets:', err);
      }
    }
  }
  await rebuildContextMenus();
});

// --- Context menu management ---

let contextMenuRebuildTimer = null;

async function rebuildContextMenus() {
  await chrome.contextMenus.removeAll();

  // Toolbar-icon (action) menu: right-click the extension icon for the same
  // copy/download choices as the popup's dropdown. Recreated on every rebuild
  // so it survives the storage-change removeAll() below.
  chrome.contextMenus.create({
    id: 'tcs-tab-urls-parent',
    title: 'Export All Open Tabs (URLs)',
    contexts: ['action']
  });
  chrome.contextMenus.create({
    id: 'tcs-tab-urls-download',
    parentId: 'tcs-tab-urls-parent',
    title: 'Download',
    contexts: ['action']
  });
  chrome.contextMenus.create({
    id: 'tcs-tab-urls-copy',
    parentId: 'tcs-tab-urls-parent',
    title: 'Copy',
    contexts: ['action']
  });
  for (const [id, { title, group }] of Object.entries(TAB_URL_MENU_ITEMS)) {
    chrome.contextMenus.create({
      id,
      parentId: group === 'download' ? 'tcs-tab-urls-download' : 'tcs-tab-urls-copy',
      title,
      contexts: ['action']
    });
  }

  chrome.contextMenus.create({
    id: 'tcs-parent',
    title: 'Trigger Code Snippets',
    contexts: ['page']
  });

  const snippets = await getSnippets();
  for (const snippet of snippets) {
    const shortcutHint = snippet.position < 9
      ? ` [Alt+Shift+${snippet.position + 1}]`
      : '';
    chrome.contextMenus.create({
      id: `tcs-snippet-${snippet.id}`,
      parentId: 'tcs-parent',
      title: snippet.name + shortcutHint,
      contexts: ['page'],
      enabled: false // disabled by default, updated per tab
    });
  }

  // Update states for the current active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await updateContextMenuStates(tab.id);
  } catch { /* ignore if no active tab */ }
}

async function updateContextMenuStates(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return; // chrome:// pages etc.
    const snippets = await getSnippets();
    for (const snippet of snippets) {
      try {
        const enabled = matchUrl(snippet.allowedUrls, tab.url);
        chrome.contextMenus.update(`tcs-snippet-${snippet.id}`, { enabled });
      } catch { /* menu item may not exist yet */ }
    }
  } catch { /* tab may no longer exist */ }
}

// Update context menu states when the active tab changes or navigates
chrome.tabs.onActivated.addListener(({ tabId }) => updateContextMenuStates(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    updateContextMenuStates(tabId);
  }
});

// --- Context menu click handler ---

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('[TCS] Context menu clicked:', info.menuItemId);
  const tabUrlItem = TAB_URL_MENU_ITEMS[info.menuItemId];
  if (tabUrlItem) {
    await handleTabUrlsAction(tabUrlItem.action, tabUrlItem.format);
    return;
  }
  if (!info.menuItemId.toString().startsWith('tcs-snippet-')) return;
  const snippetId = info.menuItemId.toString().replace('tcs-snippet-', '');
  const snippet = await getSnippetById(snippetId);
  if (!snippet) { console.log('[TCS] BAIL: context menu snippet not found'); return; }
  if (!matchUrl(snippet.allowedUrls, tab.url)) { console.log('[TCS] BAIL: context menu URL mismatch'); return; }
  executeSnippet(snippet, tab.id);
});

// --- Snippet execution ---

async function executeSnippet(snippet, tabId) {
  console.log('[TCS] executeSnippet called:', snippet.name, 'on tab:', tabId, 'code length:', snippet.code.length);

  const target = { tabId };

  try {
    await chrome.debugger.attach(target, '1.3');
    await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: snippet.code,
      userGesture: true
    });
    await chrome.debugger.detach(target);
    console.log('[TCS] executeScript SUCCESS for:', snippet.name);
  } catch (err) {
    try { await chrome.debugger.detach(target); } catch { /* already detached */ }
    console.error('[TCS] executeScript FAILED for:', snippet.name, err);
  }
}

// --- Tab URL export: gather, format (text or markdown), copy or download ---

async function getTabGroupsByWindow() {
  // Spanning mode (no "incognito":"split" in the manifest) means query({})
  // returns tabs from every window, including incognito. Raw tab objects are
  // kept (not just title/url) so the full-field markdown dump can read them.
  const tabs = await chrome.tabs.query({});
  const byWindow = new Map();
  for (const tab of tabs) {
    if (!tab.url) continue;
    if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
    byWindow.get(tab.windowId).push(tab);
  }
  return [...byWindow.values()];
}

function formatGroupsAsText(groups) {
  return groups
    .map((tabs, i) => `Window ${i + 1} (${tabs.length} tab${tabs.length === 1 ? '' : 's'}):\n${tabs.map(t => t.url).join('\n')}`)
    .join('\n\n');
}

// One row per tab -- used for both Copy-as-Markdown and Download-as-Markdown
// (Text stays to a plain URL list, for quick pasting). Flags column lists
// only the ones that are true for that tab.
const TAB_FLAG_FIELDS = ['active', 'pinned', 'incognito', 'discarded', 'frozen'];

function formatTabFlags(tab) {
  return TAB_FLAG_FIELDS.filter(f => tab[f]).map(f => `[${f}]`).join(',');
}

// Stand-in emojis for the Icon column, for cases where a real favicon image
// either can't apply or shouldn't be fetched.
const EXTENSION_ICON_EMOJI = '🧩'; // puzzle piece -- Chrome's own extensions icon
const FILE_ICON_EMOJI = '💾'; // floppy disk -- 📄 looks too close to a browser's own "image failed to load" icon
const IP_ADDRESS_EMOJI = '🖥️'; // desktop computer
const BROWSER_PAGE_EMOJI = '⚙️'; // gear -- chrome://newtab, chrome://extensions, etc.
const NO_FAVICON_EMOJI = '🌐'; // globe -- a URL was tried, nothing loaded

function isIpAddressHost(hostname) {
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true; // IPv6 literal, e.g. "[::1]"
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname); // IPv4, e.g. "192.168.1.1"
}

// Chrome doesn't report a favicon for some tabs (its own PDF viewer, e.g.) --
// guess the *registrable* domain's favicon.ico (e.g. "docs.nvidia.com" ->
// "nvidia.com") since a subdomain rarely hosts its own icon but the main
// site almost always does. A simple last-two-labels heuristic: wrong for
// two-part TLDs like .co.uk, but that just means the guess fails the same
// way a genuinely missing icon does -- verified below either way.
function guessFavicon(url) {
  try {
    const { protocol, hostname } = new URL(url);
    const mainDomain = hostname.split('.').slice(-2).join('.');
    return `${protocol}//${mainDomain}/favicon.ico`;
  } catch {
    return '';
  }
}

// HEAD-checks a candidate favicon URL so a dead link doesn't ship as a
// broken image in the export. Cached per download since many tabs on the
// same site share one favicon URL; a timeout keeps one slow/unreachable
// server from stalling the whole export.
async function faviconExists(url, cache) {
  if (cache.has(url)) return cache.get(url);
  const promise = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(url, { method: 'HEAD', signal: controller.signal });
      clearTimeout(timeout);
      const contentType = resp.headers.get('content-type') || '';
      return resp.ok && contentType.startsWith('image');
    } catch {
      return false;
    }
  })();
  cache.set(url, promise);
  return promise;
}

// Some sites' favIconUrl is a data: URI with an inline SVG (a generated
// emoji-as-icon, e.g.) rather than a normal image file, and those can carry
// literal spaces/parens -- which breaks markdown's plain ![]() link syntax,
// so it shows up as visible text instead of an image. Wrapping the
// destination in <> is CommonMark's own escape hatch for exactly this
// (a link destination allowed to contain spaces); | still needs escaping
// since a table row splits on it before any of this is parsed.
function escapeUrlForAngleBrackets(url) {
  return url.replace(/\|/g, '%7C').replace(/</g, '%3C').replace(/>/g, '%3E');
}

// Resolves one tab's Icon cell: an emoji for cases where a real favicon
// either doesn't apply (extension/local pages) or shouldn't be guessed at
// (an IP-address host -- guessing there would mean this extension probing
// an arbitrary network address on its own); otherwise { imageUrl } for a
// verified favicon (the caller turns this into markdown, deduplicated --
// some sites' favicon is a multi-KB base64 image reused across every tab);
// otherwise a generic "nothing loaded" emoji.
async function resolveTabIcon(tab, cache) {
  if (tab.url.startsWith('chrome-extension://')) return EXTENSION_ICON_EMOJI;
  if (tab.url.startsWith('file://')) return FILE_ICON_EMOJI;

  if (tab.favIconUrl) {
    // fetch() handles http(s) and data: fine, but a favIconUrl can
    // occasionally be an internal chrome://favicon2/... resource instead --
    // fetch()-ing THAT throws AND gets logged to the extension's own Errors
    // page regardless of this code catching it, so it's never attempted.
    if (!/^(https?:|data:)/.test(tab.favIconUrl)) return NO_FAVICON_EMOJI;
    return (await faviconExists(tab.favIconUrl, cache))
      ? { imageUrl: tab.favIconUrl }
      : NO_FAVICON_EMOJI;
  }

  let hostname = '';
  let scheme = '';
  try {
    ({ hostname, protocol: scheme } = new URL(tab.url));
  } catch { /* falls through to the emoji below */ }

  // Same reasoning as above: chrome://newtab, chrome://extensions, etc.
  // have no real favicon.ico to guess at, and fetch() can't reach them.
  if (scheme && scheme !== 'http:' && scheme !== 'https:') return BROWSER_PAGE_EMOJI;
  if (isIpAddressHost(hostname)) return IP_ADDRESS_EMOJI;

  const guessedUrl = guessFavicon(tab.url);
  return (guessedUrl && await faviconExists(guessedUrl, cache))
    ? { imageUrl: guessedUrl }
    : NO_FAVICON_EMOJI;
}

async function formatGroupsAsFullMarkdown(groups) {
  const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const cache = new Map();

  // Resolve every tab's icon up front, across all windows, so an identical
  // favicon (the same site open in several tabs, or every claude.ai
  // artifact tab sharing one generic multi-KB icon, seen for real) gets
  // written into the file once as a markdown reference link instead of
  // once per tab -- same picture in every row, far smaller file.
  const flatTabs = groups.flat();
  const iconResults = await Promise.all(flatTabs.map(tab => resolveTabIcon(tab, cache)));

  const refLabels = new Map(); // imageUrl -> "fav1", "fav2", ...
  const iconCellFor = (result) => {
    if (typeof result === 'string') return result; // an emoji, inlined as-is
    if (!refLabels.has(result.imageUrl)) refLabels.set(result.imageUrl, `fav${refLabels.size + 1}`);
    return `![icon][${refLabels.get(result.imageUrl)}]`;
  };

  let cursor = 0;
  const windowBlocks = groups.map((tabs, i) => {
    const rows = tabs.map((tab) => {
      const icon = iconCellFor(iconResults[cursor++]);
      return `| ${cell(tab.index)} | ${icon} | ${cell(tab.title || tab.url)} | ${cell(tab.url)} | ${cell(formatTabFlags(tab))} |`;
    }).join('\n');
    // Icon column is center-aligned (the :---: marker) so an emoji sits in
    // the same spot a real favicon image would -- most viewers auto-center
    // images but leave plain text/emoji at the default left alignment.
    return `## Window ${i + 1} (${tabs.length} tab${tabs.length === 1 ? '' : 's'})\n\n| Index | Icon | Title | URL | Flags |\n|---|:---:|---|---|---|\n${rows}`;
  });

  const refDefs = [...refLabels.entries()]
    .map(([url, label]) => `[${label}]: <${escapeUrlForAngleBrackets(url)}>`)
    .join('\n');

  return [...windowBlocks, refDefs].filter(Boolean).join('\n\n');
}

async function buildTabUrlText(format) {
  const groups = await getTabGroupsByWindow();
  // Markdown always gets the full per-tab table (icon/title/url/flags,
  // verified favicons) -- Copy and Download only ever differed in where the
  // result goes (clipboard vs. a file), never in what it contains.
  return format === 'markdown' ? await formatGroupsAsFullMarkdown(groups) : formatGroupsAsText(groups);
}

async function copyTabUrls(format) {
  const text = await buildTabUrlText(format);
  console.log(`[TCS] Copying tab URLs (${format}):\n${text}`);
  return copyToClipboard(text);
}

async function downloadTabUrls(format) {
  const text = await buildTabUrlText(format);
  const isMarkdown = format === 'markdown';
  const filename = `tab-urls-${new Date().toISOString().slice(0, 10)}.${isMarkdown ? 'md' : 'txt'}`;
  const mime = isMarkdown ? 'text/markdown' : 'text/plain';
  // A data: URL avoids a known issue where blob: URLs created in a service
  // worker aren't reliably fetchable by chrome.downloads.download(); no extra
  // permission needed since "downloads" is already declared in the manifest.
  const dataUrl = `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;

  try {
    // saveAs omitted deliberately: follows the user's own Chrome
    // "ask where to save" setting rather than forcing a dialog either way.
    await chrome.downloads.download({ url: dataUrl, filename });
    console.log('[TCS] Download started:', filename);
    return true;
  } catch (err) {
    console.error('[TCS] Download failed:', err);
    return false;
  }
}

async function handleTabUrlsAction(action, format) {
  return action === 'download' ? downloadTabUrls(format) : copyTabUrls(format);
}

// --- Offscreen clipboard (service workers have no clipboard access) ---

let creatingOffscreen = null; // in-flight createDocument promise, serializes callers

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });
  if (existing.length > 0) return;

  // getContexts alone can't prevent a double-create race (two rapid clicks both
  // see zero contexts); the shared `creating` promise makes the second caller
  // await the first createDocument instead of firing its own.
  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: 'Copy the list of open tab URLs to the clipboard.'
    });
    try {
      await creatingOffscreen;
    } finally {
      creatingOffscreen = null;
    }
  }
}

async function copyToClipboard(text) {
  try {
    await ensureOffscreenDocument();
    // Await the offscreen ack so the write finishes before we close the doc.
    const resp = await chrome.runtime.sendMessage({
      target: 'tcs-offscreen',
      type: 'copy-to-clipboard',
      text
    });
    if (!resp || !resp.ok) console.error('[TCS] Clipboard write did not confirm success');
    return !!(resp && resp.ok);
  } catch (err) {
    console.error('[TCS] Clipboard copy failed:', err);
    return false;
  } finally {
    // CLIPBOARD offscreen docs have no auto-close; free the single-doc slot.
    try { await chrome.offscreen.closeDocument(); } catch { /* already closed */ }
  }
}

// --- Message listener ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[TCS] Message received:', message.type, message);
  if (message.type === 'execute-by-position') {
    handleExecuteByPosition(message.position, sender.tab).then(() => sendResponse({ ok: true }));
    return true;
  } else if (message.type === 'execute-by-id') {
    handleExecuteById(message.snippetId, message.tabId).then(() => sendResponse({ ok: true }));
    return true;
  } else if (message.type === 'tab-urls-action') {
    handleTabUrlsAction(message.action, message.format).then((ok) => sendResponse({ ok }));
    return true;
  }
});

async function handleExecuteByPosition(position, tab) {
  console.log('[TCS] handleExecuteByPosition:', position, 'tab:', tab?.url);
  if (!tab || !tab.url) { console.log('[TCS] BAIL: no tab or url'); return; }
  const snippets = await getSnippets();
  const snippet = snippets.find(s => s.position === position);
  if (!snippet) { console.log('[TCS] BAIL: no snippet at position', position); return; }
  console.log('[TCS] Found snippet:', snippet.name, 'allowedUrls:', snippet.allowedUrls);
  const urlMatch = matchUrl(snippet.allowedUrls, tab.url);
  console.log('[TCS] URL match result:', urlMatch, 'tab.url:', tab.url);
  if (!urlMatch) return;
  executeSnippet(snippet, tab.id);
}

async function handleExecuteById(snippetId, tabId) {
  console.log('[TCS] handleExecuteById:', snippetId, 'tabId:', tabId);
  const snippet = await getSnippetById(snippetId);
  if (!snippet) { console.log('[TCS] BAIL: snippet not found for id:', snippetId); return; }
  console.log('[TCS] Found snippet:', snippet.name, 'allowedUrls:', snippet.allowedUrls);
  try {
    const tab = await chrome.tabs.get(tabId);
    console.log('[TCS] Tab url:', tab.url);
    const urlMatch = matchUrl(snippet.allowedUrls, tab.url);
    console.log('[TCS] URL match result:', urlMatch);
    if (!urlMatch) { console.log('[TCS] BAIL: URL does not match'); return; }
    executeSnippet(snippet, tabId);
  } catch (e) { console.log('[TCS] BAIL: tab error:', e.message); }
}

// --- Rebuild context menus when snippets change ---

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.snippets) {
    clearTimeout(contextMenuRebuildTimer);
    contextMenuRebuildTimer = setTimeout(() => rebuildContextMenus(), 500);
  }
});
