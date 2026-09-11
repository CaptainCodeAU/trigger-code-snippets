// Pure formatting logic for the tab-URL export feature (Copy/Download as
// Text or Markdown). No chrome.* calls here -- background.js resolves each
// tab's Icon (needs fetch/network) and hands an already-resolved tab.icon
// (an emoji string, or { imageUrl } for a verified favicon) into groups
// before calling renderExport; manager.js's settings preview calls this same
// code with fixed fake sample tabs so the preview never drifts from the real
// export.

export const FIELD_IDS = ['index', 'icon', 'title', 'url', 'flags', 'window', 'status', 'audible', 'tabId', 'discarded', 'active'];

export const FIELD_LABELS = {
  index: 'Index',
  icon: 'Icon',
  title: 'Title',
  url: 'URL',
  flags: 'Flags',
  window: 'Window',
  status: 'Status',
  audible: 'Audible',
  tabId: 'Tab ID',
  discarded: 'Discarded',
  active: 'Active'
};

// Icon is Markdown-only: plain text can't show a real favicon image, only a
// generic emoji stand-in, which adds little real information.
export const TEXT_FIELD_IDS = FIELD_IDS.filter((f) => f !== 'icon');

const TAB_FLAG_FIELDS = ['active', 'pinned', 'incognito', 'discarded', 'frozen'];

export function formatTabFlags(tab) {
  return TAB_FLAG_FIELDS.filter((f) => tab[f]).map((f) => `[${f}]`).join(',');
}

// Some sites' favIconUrl is a data: URI with an inline SVG (a generated
// emoji-as-icon, e.g.) rather than a normal image file, and those can carry
// literal spaces/parens -- which breaks markdown's plain ![]() link syntax,
// so it shows up as visible text instead of an image. Wrapping the
// destination in <> is CommonMark's own escape hatch for exactly this
// (a link destination allowed to contain spaces); | still needs escaping
// since a table row splits on it before any of this is parsed.
export function escapeUrlForAngleBrackets(url) {
  return url.replace(/\|/g, '%7C').replace(/</g, '%3C').replace(/>/g, '%3E');
}

function windowLabel(tabs, i) {
  return `Window ${i + 1} (${tabs.length} tab${tabs.length === 1 ? '' : 's'})`;
}

function rawFieldValue(tab, fieldId, windowIndex) {
  switch (fieldId) {
    // Chrome numbers tabs from 0; shown 1-based since this is for a person
    // counting tabs left to right, not code indexing into an array.
    case 'index': return tab.index + 1;
    case 'title': return tab.title || tab.url;
    case 'url': return tab.url;
    case 'flags': return formatTabFlags(tab);
    case 'window': return `Window ${windowIndex + 1}`;
    case 'status': return tab.status || '';
    case 'audible': return tab.audible ? 'Yes' : '';
    case 'tabId': return tab.id;
    case 'discarded': return tab.discarded ? 'Yes' : '';
    case 'active': return tab.active ? 'Yes' : '';
    default: return '';
  }
}

// Turns a tab's pre-resolved icon into markdown -- an emoji is inlined as-is;
// a verified favicon becomes a reference-style image link, deduplicated via
// refLabels so the same favicon (many tabs on one site) is only defined once.
function iconMarkdown(tab, refLabels) {
  const icon = tab.icon;
  if (typeof icon === 'string') return icon;
  if (!icon) return '';
  if (!refLabels.has(icon.imageUrl)) refLabels.set(icon.imageUrl, `fav${refLabels.size + 1}`);
  return `![icon][${refLabels.get(icon.imageUrl)}]`;
}

// A markdown table cell: pipes/newlines escaped since they'd otherwise break
// the row syntax.
function tableCell(tab, fieldId, refLabels, windowIndex) {
  if (fieldId === 'icon') return iconMarkdown(tab, refLabels);
  return String(rawFieldValue(tab, fieldId, windowIndex) ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

// A plain value for list-shaped output. Markdown-list still escapes pipes --
// a stray "|" in a title would otherwise be indistinguishable from the " | "
// separator used to join fields on one line, and staying escaped keeps the
// value safe to paste straight into a real markdown table later. Plain text
// has no such convention, so it's left as-is there.
function plainValue(tab, fieldId, refLabels, windowIndex, isMarkdown) {
  if (fieldId === 'icon') return iconMarkdown(tab, refLabels);
  const value = String(rawFieldValue(tab, fieldId, windowIndex) ?? '').replace(/\n/g, ' ');
  return isMarkdown ? value.replace(/\|/g, '\\|') : value;
}

function withRefDefs(blocks, refLabels) {
  const refDefs = [...refLabels.entries()]
    .map(([url, label]) => `[${label}]: <${escapeUrlForAngleBrackets(url)}>`)
    .join('\n');
  return [...blocks, refDefs].filter(Boolean).join('\n\n');
}

// ---- Markdown table: one row per tab, columns = chosen fields ----

function renderMarkdownTable(groups, fields) {
  const refLabels = new Map();
  const windowBlocks = groups.map((tabs, i) => {
    const header = `| ${fields.map((f) => FIELD_LABELS[f]).join(' | ')} |`;
    // Icon column is center-aligned so an emoji sits where a real favicon
    // image would; other columns stay left-aligned (the default).
    const align = `|${fields.map((f) => (f === 'icon' ? ':---:' : '---')).join('|')}|`;
    const rows = tabs
      .map((tab) => `| ${fields.map((f) => tableCell(tab, f, refLabels, i)).join(' | ')} |`)
      .join('\n');
    return `## ${windowLabel(tabs, i)}\n\n${header}\n${align}\n${rows}`;
  });
  return withRefDefs(windowBlocks, refLabels);
}

// ---- Markdown transposed: each tab becomes its own 2-column (Field | Value)
// mini table, stacked under the window heading ----

function renderMarkdownTransposed(groups, fields) {
  const refLabels = new Map();
  const windowBlocks = groups.map((tabs, i) => {
    const tabBlocks = tabs.map((tab) => {
      const rows = fields
        .map((f) => `| ${FIELD_LABELS[f]} | ${tableCell(tab, f, refLabels, i)} |`)
        .join('\n');
      const title = String(tab.title || tab.url).replace(/\n/g, ' ');
      return `**${title}**\n\n| Field | Value |\n|---|---|\n${rows}`;
    }).join('\n\n');
    return `## ${windowLabel(tabs, i)}\n\n${tabBlocks}`;
  });
  return withRefDefs(windowBlocks, refLabels);
}

// ---- List (Markdown-as-list, and Text always): normal joins the chosen
// fields onto one line per tab; transposed prints one "Field: Value" line per
// field, tabs separated by a blank line. ----

function renderList(groups, fields, orientation, formatKind) {
  const isMarkdown = formatKind === 'markdown';
  const refLabels = new Map();

  const windowBlocks = groups.map((tabs, i) => {
    const heading = isMarkdown ? `## ${windowLabel(tabs, i)}` : `${windowLabel(tabs, i)}:`;
    const body = orientation === 'transposed'
      ? tabs.map((tab) => fields
        .map((f) => `${isMarkdown ? `**${FIELD_LABELS[f]}**` : FIELD_LABELS[f]}: ${plainValue(tab, f, refLabels, i, isMarkdown)}`)
        .join('\n')).join('\n\n')
      : tabs.map((tab) => (isMarkdown ? '- ' : '') + fields.map((f) => plainValue(tab, f, refLabels, i, isMarkdown)).join(' | ')).join('\n');
    return `${heading}${isMarkdown ? '\n\n' : '\n'}${body}`;
  });

  return isMarkdown ? withRefDefs(windowBlocks, refLabels) : windowBlocks.join('\n\n');
}

// Single entry point: dispatches on format + layout + orientation.
// settingsForFormat is one of { fields, layout, orientation } (markdown) or
// { fields, orientation } (text -- layout is implicitly always list-shaped).
export function renderExport(groups, format, settingsForFormat) {
  const { fields, layout, orientation } = settingsForFormat;
  if (format === 'markdown' && layout === 'table') {
    return orientation === 'transposed'
      ? renderMarkdownTransposed(groups, fields)
      : renderMarkdownTable(groups, fields);
  }
  return renderList(groups, fields, orientation, format);
}
