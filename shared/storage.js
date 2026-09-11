// Storage utilities for Trigger Code Snippets
// Used by background.js, popup.js, and manager.js (ES module)

import { FIELD_IDS, TEXT_FIELD_IDS, MARKDOWN_STYLE_IDS } from './tabExportFormat.js';

export async function getSnippets() {
  const { snippets = [] } = await chrome.storage.local.get('snippets');
  return snippets.sort((a, b) => a.position - b.position);
}

export async function saveSnippets(snippets) {
  snippets.forEach((s, i) => s.position = i);
  await chrome.storage.local.set({ snippets });
}

export async function getSnippetById(id) {
  const snippets = await getSnippets();
  return snippets.find(s => s.id === id) || null;
}

export async function addSnippet(snippet) {
  const snippets = await getSnippets();
  snippets.push(snippet);
  await saveSnippets(snippets);
  return snippet;
}

export async function updateSnippet(id, updates) {
  const snippets = await getSnippets();
  const idx = snippets.findIndex(s => s.id === id);
  if (idx === -1) return null;
  Object.assign(snippets[idx], updates);
  await saveSnippets(snippets);
  return snippets[idx];
}

export async function deleteSnippet(id) {
  let snippets = await getSnippets();
  snippets = snippets.filter(s => s.id !== id);
  await saveSnippets(snippets);
}

export async function reorderSnippets(orderedIds) {
  const snippets = await getSnippets();
  const map = new Map(snippets.map(s => [s.id, s]));
  const reordered = orderedIds.map(id => map.get(id)).filter(Boolean);
  // Append any snippets not in orderedIds at the end
  for (const s of snippets) {
    if (!orderedIds.includes(s.id)) reordered.push(s);
  }
  await saveSnippets(reordered);
}

export async function isInitialized() {
  const { initialized = false } = await chrome.storage.local.get('initialized');
  return initialized;
}

export async function setInitialized() {
  await chrome.storage.local.set({ initialized: true });
}

// URL pattern matching — converts Chrome match patterns to RegExp
export function matchUrl(patterns, url) {
  if (!url || !patterns || patterns.length === 0) return false;
  return patterns.some(pattern => {
    try {
      const regex = matchPatternToRegex(pattern);
      return regex.test(url);
    } catch {
      return false;
    }
  });
}

function matchPatternToRegex(pattern) {
  // Chrome match pattern: <scheme>://<host>/<path>
  const match = pattern.match(/^(\*|https?|file|ftp):\/\/(\*|(?:\*\.)?[^/*]+)\/(.*)$/);
  if (!match) throw new Error(`Invalid match pattern: ${pattern}`);

  const [, scheme, host, pat] = match;

  let schemeRegex;
  if (scheme === '*') schemeRegex = 'https?';
  else schemeRegex = escapeRegex(scheme);

  let hostRegex;
  if (host === '*') hostRegex = '[^/]+';
  else if (host.startsWith('*.')) hostRegex = '(?:[^/]+\\.)?' + escapeRegex(host.slice(2));
  else hostRegex = escapeRegex(host);

  const pathRegex = pat.split('*').map(escapeRegex).join('.*');

  return new RegExp(`^${schemeRegex}://${hostRegex}/${pathRegex}$`);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Validate a Chrome match pattern
export function isValidMatchPattern(pattern) {
  return /^(\*|https?|file|ftp):\/\/(\*|(?:\*\.)?[^/*]+)\/(.*)$/.test(pattern);
}

// Export all snippets as a JSON string
export async function exportSnippets() {
  const snippets = await getSnippets();
  // Strip internal fields for cleaner export
  const exported = snippets.map(({ name, code, allowedUrls }) => ({
    name, code, allowedUrls
  }));
  return JSON.stringify(exported, null, 2);
}

// Import snippets from parsed JSON array
export async function importSnippets(data, mode) {
  if (mode === 'replace') {
    const snippets = data.map((s, i) => ({
      id: crypto.randomUUID(),
      name: s.name,
      code: s.code,
      allowedUrls: s.allowedUrls || ['*://*/*'],
      position: i
    }));
    await saveSnippets(snippets);
    return snippets;
  }

  // Append mode
  const existing = await getSnippets();
  const existingNames = existing.map(s => s.name);
  const newSnippets = data.map((s, i) => {
    const name = deduplicateName(s.name, existingNames);
    existingNames.push(name);
    return {
      id: crypto.randomUUID(),
      name,
      code: s.code,
      allowedUrls: s.allowedUrls || ['*://*/*'],
      position: existing.length + i
    };
  });

  const all = [...existing, ...newSnippets];
  await saveSnippets(all);
  return all;
}

function deduplicateName(name, existingNames) {
  if (!existingNames.includes(name)) return name;
  let counter = 2;
  while (existingNames.includes(`${name} (${counter})`)) counter++;
  return `${name} (${counter})`;
}

// Validate imported JSON schema
export function validateImportSchema(data) {
  if (!Array.isArray(data)) return false;
  return data.every(s =>
    typeof s.name === 'string' && s.name.trim() !== '' &&
    typeof s.code === 'string' &&
    Array.isArray(s.allowedUrls)
  );
}

// --- Tab-URL export settings (Copy/Download menu formatting) ---

// Reproduces today's hardcoded output exactly, so existing users see no
// change until they open the settings panel and touch something.
export const DEFAULT_EXPORT_SETTINGS = {
  markdown: {
    fields: ['index', 'icon', 'title', 'url'],
    style: 'table-grid',
    collapsible: false
  },
  text: {
    fields: ['url'],
    orientation: 'normal'
  }
};

// Drops any saved field id that's no longer a real field (e.g. one that got
// removed from FIELD_IDS after a user had already checked it) -- otherwise a
// stale id lingers forever as a checked-but-blank row, since nothing else
// ever prunes what's already saved. Falls back to the shipped defaults if
// that leaves nothing checked at all.
function sanitizeFields(fields, allowedFieldIds, fallback) {
  const cleaned = Array.isArray(fields) ? fields.filter((f) => allowedFieldIds.includes(f)) : [];
  return cleaned.length > 0 ? cleaned : [...fallback];
}

// Falls back to the shipped default when a saved value isn't one of the
// allowed choices -- same self-healing intent as sanitizeFields, needed
// because isValidExportFormatSettings (used on save) rejects anything
// outside these exact values, so a bad saved value would otherwise block
// every future save, not just get ignored.
function sanitizeChoice(value, allowedValues, fallback) {
  return allowedValues.includes(value) ? value : fallback;
}

// One-time shape migration for settings saved by the pre-Style-gallery
// build (v1.4.0 and earlier): { layout, orientation } -> the closest new
// { style }. table+normal and table+transposed map onto the two styles that
// still exist; the old free-field "list" layout has no exact equivalent
// now that every markdown shape is its own named style, so it lands on
// Bulleted Links as the closest one-line-per-tab style.
function migrateMarkdownSettings(saved) {
  if (!saved || saved.style || !saved.layout) return saved;
  const { layout, orientation, ...rest } = saved;
  const style = layout === 'table'
    ? (orientation === 'transposed' ? 'table-card' : 'table-grid')
    : 'bulleted-links';
  return { ...rest, style };
}

function mergeExportSettings(saved) {
  const merged = {
    markdown: { ...DEFAULT_EXPORT_SETTINGS.markdown, ...(migrateMarkdownSettings(saved?.markdown) || {}) },
    text: { ...DEFAULT_EXPORT_SETTINGS.text, ...(saved?.text || {}) }
  };
  merged.markdown.fields = sanitizeFields(merged.markdown.fields, FIELD_IDS, DEFAULT_EXPORT_SETTINGS.markdown.fields);
  merged.markdown.style = sanitizeChoice(merged.markdown.style, MARKDOWN_STYLE_IDS, DEFAULT_EXPORT_SETTINGS.markdown.style);
  merged.markdown.collapsible = typeof merged.markdown.collapsible === 'boolean'
    ? merged.markdown.collapsible
    : DEFAULT_EXPORT_SETTINGS.markdown.collapsible;
  merged.text.fields = sanitizeFields(merged.text.fields, TEXT_FIELD_IDS, DEFAULT_EXPORT_SETTINGS.text.fields);
  merged.text.orientation = sanitizeChoice(merged.text.orientation, ['normal', 'transposed'], DEFAULT_EXPORT_SETTINGS.text.orientation);
  return merged;
}

export async function getExportSettings() {
  const { exportSettings } = await chrome.storage.local.get('exportSettings');
  return mergeExportSettings(exportSettings);
}

function isValidFieldSelection(fields, allowedFieldIds) {
  return Array.isArray(fields) && fields.length > 0 && fields.every((f) => allowedFieldIds.includes(f));
}

function isValidMarkdownSettings(settings) {
  if (!settings || typeof settings !== 'object') return false;
  if (!isValidFieldSelection(settings.fields, FIELD_IDS)) return false;
  if (!MARKDOWN_STYLE_IDS.includes(settings.style)) return false;
  return typeof settings.collapsible === 'boolean';
}

function isValidTextSettings(settings) {
  if (!settings || typeof settings !== 'object') return false;
  if (!isValidFieldSelection(settings.fields, TEXT_FIELD_IDS)) return false;
  return settings.orientation === 'normal' || settings.orientation === 'transposed';
}

export async function saveExportSettings(settings) {
  if (!isValidMarkdownSettings(settings.markdown)) {
    throw new Error('Invalid markdown export settings');
  }
  if (!isValidTextSettings(settings.text)) {
    throw new Error('Invalid text export settings');
  }
  await chrome.storage.local.set({ exportSettings: settings });
}
