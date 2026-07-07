// Clipboard writer for the service worker.
//
// MV3 service workers have no DOM, so the SW delegates clipboard writes to this
// offscreen document. navigator.clipboard.writeText() needs window focus, which
// an offscreen document can never have, so we use the textarea + execCommand('copy')
// path (the approach from Chrome's official offscreen-clipboard-write cookbook sample).

const target = document.getElementById('clipboard-target');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // runtime.sendMessage broadcasts to every extension context; ignore anything
  // not explicitly addressed to this offscreen document.
  if (!message || message.target !== 'tcs-offscreen') return;
  if (message.type !== 'copy-to-clipboard') return;

  let ok = false;
  try {
    target.value = typeof message.text === 'string' ? message.text : '';
    target.select();
    ok = document.execCommand('copy');
  } catch {
    // execCommand threw; ok stays false
  } finally {
    target.value = '';
  }
  sendResponse({ ok });
});
