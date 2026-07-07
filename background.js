import {
  getSnippets, saveSnippets, getSnippetById,
  matchUrl, isInitialized, setInitialized
} from './shared/storage.js';

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

  // Toolbar-icon (action) menu: right-click the extension icon to dump every
  // open tab's URL to the console and clipboard. Recreated on every rebuild so
  // it survives the storage-change removeAll() below.
  chrome.contextMenus.create({
    id: 'list-all-tab-urls',
    title: 'List all tab URLs',
    contexts: ['action']
  });

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
  if (info.menuItemId === 'list-all-tab-urls') {
    await listAllTabUrls();
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

// --- List all tab URLs (toolbar-icon menu) ---

async function listAllTabUrls() {
  // Spanning mode (no "incognito":"split" in the manifest) means query({})
  // returns tabs from every window, including incognito.
  const tabs = await chrome.tabs.query({});
  const urls = tabs.map(t => t.url).filter(Boolean);
  const text = urls.join('\n');
  console.log(`[TCS] All tab URLs (${urls.length}):\n${text}`);
  await copyToClipboard(text);
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
  } catch (err) {
    console.error('[TCS] Clipboard copy failed:', err);
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
