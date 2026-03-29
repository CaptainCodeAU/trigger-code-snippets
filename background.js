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
