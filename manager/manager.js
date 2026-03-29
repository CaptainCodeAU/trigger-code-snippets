import {
  getSnippets, saveSnippets,
  isValidMatchPattern, exportSnippets as exportToJson,
  importSnippets as doImport, validateImportSchema
} from '../shared/storage.js';

// ===== State =====
let snippets = [];
let selectedId = null;
let saveTimeout = null;
let saveIndicatorTimeout = null;

// ===== DOM References =====
const snippetListEl = document.getElementById('snippet-list');
const snippetCountEl = document.getElementById('snippet-count');
const editorPlaceholder = document.getElementById('editor-placeholder');
const editorContent = document.getElementById('editor-content');
const nameInput = document.getElementById('snippet-name');
const urlsInput = document.getElementById('snippet-urls');
const codeInput = document.getElementById('snippet-code');
const urlValidation = document.getElementById('url-validation');
const saveIndicator = document.getElementById('save-indicator');
const btnAdd = document.getElementById('btn-add');
const btnImport = document.getElementById('btn-import');
const btnExport = document.getElementById('btn-export');
const btnDelete = document.getElementById('btn-delete');
const importInput = document.getElementById('import-input');
const lineNumbers = document.getElementById('line-numbers');

// ===== Initialization =====
async function init() {
  snippets = await getSnippets();
  renderList();
  setupEventListeners();
}

function setupEventListeners() {
  btnAdd.addEventListener('click', addSnippet);
  btnDelete.addEventListener('click', deleteSelectedSnippet);
  btnImport.addEventListener('click', () => importInput.click());
  btnExport.addEventListener('click', handleExport);
  importInput.addEventListener('change', handleImportFile);

  nameInput.addEventListener('input', () => {
    updateSelectedField('name', nameInput.value);
    // Update name in sidebar too
    const item = snippetListEl.querySelector(`.snippet-item[data-id="${selectedId}"]`);
    if (item) {
      item.querySelector('.snippet-item-name').textContent = nameInput.value || 'Untitled';
    }
  });

  urlsInput.addEventListener('input', () => {
    const urls = urlsInput.value.split('\n').map(l => l.trim()).filter(Boolean);
    updateSelectedField('allowedUrls', urls);
    validateUrls(urls);
  });

  codeInput.addEventListener('input', () => {
    updateSelectedField('code', codeInput.value);
    updateLineNumbers();
  });

  codeInput.addEventListener('scroll', syncLineNumberScroll);
  codeInput.addEventListener('mouseup', updateLineNumbers);

  // Tab key in code textarea inserts 2 spaces
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = codeInput.selectionStart;
      const end = codeInput.selectionEnd;
      codeInput.value = codeInput.value.substring(0, start) + '  ' + codeInput.value.substring(end);
      codeInput.selectionStart = codeInput.selectionEnd = start + 2;
      codeInput.dispatchEvent(new Event('input'));
    }
  });
}

// ===== Render Functions =====

function renderList() {
  snippetListEl.innerHTML = '';
  snippetCountEl.textContent = snippets.length;

  snippets.forEach((snippet, index) => {
    const item = document.createElement('div');
    item.className = 'snippet-item' + (snippet.id === selectedId ? ' active' : '');
    item.dataset.id = snippet.id;
    item.dataset.index = index;
    item.draggable = true;

    // Drag handle
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '\u2261'; // ≡
    item.appendChild(handle);

    // Position number
    const posEl = document.createElement('span');
    posEl.className = 'snippet-position' + (index < 9 ? ' has-shortcut' : '');
    posEl.textContent = index + 1;
    item.appendChild(posEl);

    // Name
    const nameEl = document.createElement('span');
    nameEl.className = 'snippet-item-name';
    nameEl.textContent = snippet.name || 'Untitled';
    item.appendChild(nameEl);

    // Shortcut hint for first 9
    if (index < 9) {
      const shortcutEl = document.createElement('span');
      shortcutEl.className = 'snippet-shortcut';
      shortcutEl.textContent = `Alt+Shift+${index + 1}`;
      item.appendChild(shortcutEl);
    }

    // Click to select
    item.addEventListener('click', () => selectSnippet(snippet.id));

    // Drag events
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('dragleave', handleDragLeave);
    item.addEventListener('drop', handleDrop);
    item.addEventListener('dragend', handleDragEnd);

    snippetListEl.appendChild(item);
  });
}

function renderEditor() {
  if (!selectedId) {
    editorPlaceholder.style.display = '';
    editorContent.style.display = 'none';
    return;
  }

  const snippet = snippets.find(s => s.id === selectedId);
  if (!snippet) {
    selectedId = null;
    renderEditor();
    return;
  }

  editorPlaceholder.style.display = 'none';
  editorContent.style.display = '';

  nameInput.value = snippet.name;
  urlsInput.value = (snippet.allowedUrls || []).join('\n');
  codeInput.value = snippet.code;
  urlValidation.textContent = '';
  updateLineNumbers();
}

// ===== Snippet CRUD =====

function addSnippet() {
  if (snippets.length >= 100) {
    alert('Maximum of 100 snippets reached. Delete some snippets to add new ones.');
    return;
  }

  const newSnippet = {
    id: crypto.randomUUID(),
    name: 'New Snippet',
    code: '',
    allowedUrls: ['*://*/*'],
    position: snippets.length
  };

  snippets.push(newSnippet);
  renderList();
  selectSnippet(newSnippet.id);
  scheduleSave();
  nameInput.focus();
  nameInput.select();
}

function deleteSelectedSnippet() {
  if (!selectedId) return;
  const snippet = snippets.find(s => s.id === selectedId);
  if (!snippet) return;

  if (!confirm(`Delete snippet "${snippet.name}"?`)) return;

  snippets = snippets.filter(s => s.id !== selectedId);
  snippets.forEach((s, i) => s.position = i);
  selectedId = null;
  renderList();
  renderEditor();
  scheduleSave();
}

function selectSnippet(id) {
  selectedId = id;
  renderList();
  renderEditor();
}

// ===== Field Updates =====

function updateSelectedField(field, value) {
  const snippet = snippets.find(s => s.id === selectedId);
  if (!snippet) return;
  snippet[field] = value;
  scheduleSave();
}

// ===== URL Validation =====

function validateUrls(urls) {
  const errors = [];
  for (const url of urls) {
    if (!isValidMatchPattern(url)) {
      errors.push(`Invalid: ${url}`);
    }
  }
  urlValidation.textContent = errors.join('\n');
  urlValidation.style.display = errors.length ? '' : 'none';
}

// ===== Auto-Save =====

function scheduleSave() {
  updateSaveIndicator('saving');
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    await saveSnippets([...snippets]);
    updateSaveIndicator('saved');
    clearTimeout(saveIndicatorTimeout);
    saveIndicatorTimeout = setTimeout(() => updateSaveIndicator('idle'), 2500);
  }, 800);
}

function updateSaveIndicator(state) {
  saveIndicator.className = 'save-indicator';
  clearTimeout(saveIndicatorTimeout);

  switch (state) {
    case 'saving':
      saveIndicator.textContent = 'Saving...';
      saveIndicator.classList.add('saving');
      break;
    case 'saved':
      saveIndicator.textContent = 'Auto-saved \u2713';
      saveIndicator.classList.add('saved');
      break;
    case 'idle':
      saveIndicator.classList.add('fading');
      saveIndicatorTimeout = setTimeout(() => {
        saveIndicator.textContent = '';
        saveIndicator.className = 'save-indicator';
      }, 1000);
      break;
  }
}

// ===== Drag and Drop =====

let dragSourceIndex = null;

function handleDragStart(e) {
  dragSourceIndex = parseInt(e.currentTarget.dataset.index);
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragSourceIndex.toString());
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const item = e.currentTarget;
  const rect = item.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;

  // Remove existing indicators
  item.classList.remove('drag-over-top', 'drag-over-bottom');

  if (e.clientY < midY) {
    item.classList.add('drag-over-top');
  } else {
    item.classList.add('drag-over-bottom');
  }
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over-top', 'drag-over-bottom');
}

function handleDrop(e) {
  e.preventDefault();
  const target = e.currentTarget;
  target.classList.remove('drag-over-top', 'drag-over-bottom');

  const targetIndex = parseInt(target.dataset.index);
  if (dragSourceIndex === null || dragSourceIndex === targetIndex) return;

  const rect = target.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  let insertAt = e.clientY < midY ? targetIndex : targetIndex + 1;

  // Adjust for removal of source
  if (dragSourceIndex < insertAt) insertAt--;

  // Reorder
  const [moved] = snippets.splice(dragSourceIndex, 1);
  snippets.splice(insertAt, 0, moved);
  snippets.forEach((s, i) => s.position = i);

  renderList();
  scheduleSave();
}

function handleDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  // Clean up any lingering indicators
  snippetListEl.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  dragSourceIndex = null;
}

// ===== Import / Export =====

async function handleExport() {
  const json = await exportToJson();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'trigger-code-snippets-export.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch {
    alert('Invalid JSON file. Please select a valid snippets export file.');
    importInput.value = '';
    return;
  }

  if (!validateImportSchema(data)) {
    alert('Invalid snippet format. Each snippet must have a name, code, and allowedUrls array.');
    importInput.value = '';
    return;
  }

  // Show import mode dialog
  showImportDialog(data);
  importInput.value = '';
}

function showImportDialog(data) {
  const overlay = document.createElement('div');
  overlay.className = 'import-dialog-overlay';

  const snippetWord = data.length === 1 ? 'snippet' : 'snippets';

  overlay.innerHTML = `
    <div class="import-dialog">
      <h3>Import ${data.length} ${snippetWord}</h3>
      <p>Choose how to import:</p>
      <div class="import-dialog-buttons">
        <button class="btn btn-secondary" id="import-cancel">Cancel</button>
        <button class="btn btn-secondary" id="import-append">Append to existing</button>
        <button class="btn btn-primary" id="import-replace">Replace all</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#import-cancel').addEventListener('click', () => {
    overlay.remove();
  });

  overlay.querySelector('#import-replace').addEventListener('click', async () => {
    overlay.remove();
    snippets = await doImport(data, 'replace');
    selectedId = null;
    renderList();
    renderEditor();
    updateSaveIndicator('saved');
  });

  overlay.querySelector('#import-append').addEventListener('click', async () => {
    overlay.remove();
    snippets = await doImport(data, 'append');
    renderList();
    updateSaveIndicator('saved');
  });

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ===== Line Numbers =====

function updateLineNumbers() {
  const lineCount = (codeInput.value.match(/\n/g) || []).length + 1;
  const numbers = [];
  for (let i = 1; i <= lineCount; i++) numbers.push(i);
  lineNumbers.textContent = numbers.join('\n');
  syncLineNumberScroll();
}

function syncLineNumberScroll() {
  lineNumbers.scrollTop = codeInput.scrollTop;
}

// ===== Sidebar Resize =====

function setupResize() {
  const sidebar = document.getElementById('sidebar');
  const handle = document.getElementById('resize-handle');
  let startX, startWidth;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    handle.classList.add('active');
    document.body.classList.add('resizing');

    function onMouseMove(e) {
      const newWidth = startWidth + (e.clientX - startX);
      const clamped = Math.max(200, Math.min(600, newWidth));
      sidebar.style.width = clamped + 'px';
    }

    function onMouseUp() {
      handle.classList.remove('active');
      document.body.classList.remove('resizing');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

// ===== Init =====
init();
setupResize();
