import { getSnippets, matchUrl } from '../shared/storage.js';

async function init() {
  // Settings icon -> options page. Wired first so it works even when there
  // are no snippets (the empty-state path returns early below).
  document.getElementById('settings-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // Copy-URLs icon -> ask the service worker to copy every open tab's URL to the
  // clipboard (same action as the toolbar-icon menu), with brief inline feedback.
  const copyBtn = document.getElementById('copy-urls-btn');
  copyBtn.addEventListener('click', async () => {
    copyBtn.disabled = true;
    let ok = false;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'copy-all-tab-urls' });
      ok = !!(resp && resp.ok);
    } catch {
      ok = false;
    }
    copyBtn.disabled = false;
    copyBtn.classList.toggle('done', ok);
    copyBtn.classList.toggle('failed', !ok);
    copyBtn.title = ok ? 'Copied!' : 'Copy failed';
    setTimeout(() => {
      copyBtn.classList.remove('done', 'failed');
      copyBtn.title = 'Copy all tab URLs to clipboard';
    }, 1400);
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const snippets = await getSnippets();
  const list = document.getElementById('snippet-list');

  if (snippets.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        No snippets configured.<br>
        <a id="open-options">Open manager to add snippets</a>
      </div>`;
    list.querySelector('#open-options').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
      window.close();
    });
    return;
  }

  // Show up to 100 snippets
  const visible = snippets.slice(0, 100);

  for (const snippet of visible) {
    const enabled = tab?.url ? matchUrl(snippet.allowedUrls, tab.url) : false;
    const item = document.createElement('div');
    item.className = 'snippet-item' + (enabled ? '' : ' disabled');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'snippet-name';
    nameSpan.textContent = snippet.name;
    item.appendChild(nameSpan);

    if (snippet.position < 9) {
      const badge = document.createElement('span');
      badge.className = 'shortcut-badge';
      badge.textContent = `Alt+Shift+${snippet.position + 1}`;
      item.appendChild(badge);
    }

    if (enabled) {
      item.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({
          type: 'execute-by-id',
          snippetId: snippet.id,
          tabId: tab.id
        });
        window.close();
      });
    }

    list.appendChild(item);
  }

  if (snippets.length > 100) {
    const more = document.createElement('div');
    more.className = 'empty-state';
    more.textContent = `+${snippets.length - 100} more in manager`;
    list.appendChild(more);
  }
}

init();
