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

  // Annotate each row with its enabled (URL-matching) state once.
  const rows = visible.map(snippet => ({
    snippet,
    enabled: tab?.url ? matchUrl(snippet.allowedUrls, tab.url) : false
  }));

  // Display order (popup only - saved order and shortcut slots are unchanged):
  // rows with a shortcut (position < 9) keep their fixed slots so their
  // Alt+Shift+N badge stays correct; among the no-shortcut rows, active
  // (enabled) ones are shown before disabled ones, stable within each group.
  const withShortcut = rows.filter(r => r.snippet.position < 9);
  const noShortcut = rows.filter(r => r.snippet.position >= 9);
  const displayRows = [
    ...withShortcut,
    ...noShortcut.filter(r => r.enabled),
    ...noShortcut.filter(r => !r.enabled)
  ];

  // Enabled rows, in display order, for keyboard navigation and Enter-to-run.
  const selectable = [];

  async function runSnippet(snippet) {
    await chrome.runtime.sendMessage({
      type: 'execute-by-id',
      snippetId: snippet.id,
      tabId: tab.id
    });
    window.close();
  }

  for (const { snippet, enabled } of displayRows) {
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
      item.addEventListener('click', () => runSnippet(snippet));
      selectable.push({ el: item, snippet });
    } else {
      item.title = "Doesn't run here - URL patterns don't match this page";
    }

    list.appendChild(item);
  }

  if (snippets.length > 100) {
    const more = document.createElement('div');
    more.className = 'empty-state';
    more.textContent = `+${snippets.length - 100} more in manager`;
    list.appendChild(more);
  }

  // ===== Keyboard navigation =====
  // Only wired here, in the non-empty path (the empty-state branch above
  // returns first), so keys no-op when there are no snippets. Disabled rows
  // are never in `selectable`, so navigation skips them automatically.
  let highlightIndex = -1;

  function setHighlight(index) {
    if (selectable[highlightIndex]) {
      selectable[highlightIndex].el.classList.remove('highlighted');
    }
    highlightIndex = index;
    const current = selectable[highlightIndex];
    if (current) {
      current.el.classList.add('highlighted');
      current.el.scrollIntoView({ block: 'nearest' });
    }
  }

  document.addEventListener('keydown', (e) => {
    if (!selectable.length) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlight(Math.min(highlightIndex + 1, selectable.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlight(Math.max(highlightIndex - 1, 0));
        break;
      case 'Enter':
        if (selectable[highlightIndex]) {
          e.preventDefault();
          runSnippet(selectable[highlightIndex].snippet);
        }
        break;
      case 'Escape':
        window.close();
        break;
    }
  });
}

init();
