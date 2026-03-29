// Content script: listens for Alt+Shift+1-9 keyboard shortcuts
// Sends messages to background service worker to execute snippets
(function () {
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || !e.shiftKey) return;

    // Use e.code for physical key (layout-independent)
    const match = e.code.match(/^Digit([1-9])$/);
    if (!match) return;

    const position = parseInt(match[1], 10) - 1; // 0-indexed

    e.preventDefault();
    e.stopPropagation();

    chrome.runtime.sendMessage({
      type: 'execute-by-position',
      position
    });
  }, true); // capture phase
})();
