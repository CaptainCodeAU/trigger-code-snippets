// Pure formatting logic for the tab-URL export feature (Copy/Download as
// Text or Markdown). No chrome.* calls here -- background.js resolves each
// tab's Icon (needs fetch/network) and hands an already-resolved tab.icon
// (an emoji string, or { imageUrl } for a verified favicon) into groups
// before calling renderExport; manager.js's settings preview calls this same
// code with fixed fake sample tabs so the preview never drifts from the real
// export.

export const FIELD_IDS = ['index', 'icon', 'title', 'url', 'flags', 'window', 'status', 'audible', 'tabId', 'discarded', 'active'];

// Markdown "Style" gallery -- replaces the old Layout x Orientation pair.
// fixedFields === null means the style renders whichever fields the user
// picked (the two table styles); an array means the style's shape is fixed
// (e.g. a markdown link fuses title+url) and the Fields checklist is
// disabled in the manager UI for it -- picking a different field there
// would have no visible effect since these renderers don't consult `fields`.
export const MARKDOWN_STYLES = [
  { id: 'table-grid', label: 'Table (Grid)', fixedFields: null },
  { id: 'table-card', label: 'Table (Card)', fixedFields: null },
  { id: 'numbered-links', label: 'Numbered Links', fixedFields: ['title', 'url'] },
  { id: 'bulleted-links', label: 'Bulleted Links', fixedFields: ['title', 'url'] },
  { id: 'checklist', label: 'Checklist', fixedFields: ['title', 'url'] },
  { id: 'title-indented-url', label: 'Title + Indented URL', fixedFields: ['title', 'url'] },
  { id: 'bare-urls', label: 'Bare URLs', fixedFields: ['url'] },
  { id: 'title-em-dash-url', label: 'Title — URL', fixedFields: ['title', 'url'] },
  { id: 'blockquote', label: 'Blockquote', fixedFields: ['title', 'url'] },
  { id: 'heading-per-tab', label: 'Heading per Tab', fixedFields: ['title', 'url'] }
];

export const MARKDOWN_STYLE_IDS = MARKDOWN_STYLES.map((s) => s.id);

// Only the two table styles can ever show the Icon field (every other style
// fixes its fields to title/url, neither of which is icon) -- background.js
// uses this to skip the favicon network round-trips entirely otherwise.
export function markdownStyleUsesIcon(styleId) {
  const meta = MARKDOWN_STYLES.find((s) => s.id === styleId);
  return !meta?.fixedFields;
}

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

// Every markdown style shares this: a window is either a "## " heading
// followed by its body, or -- when the Collapsible modifier is on -- a
// <details> block whose <summary> is that same label. One switch point so
// the modifier works identically across every style, not just the new ones.
function wrapWindowBlock(label, body, collapsible) {
  return collapsible
    ? `<details>\n<summary>${label}</summary>\n\n${body}\n\n</details>`
    : `## ${label}\n\n${body}`;
}

function plainTitle(tab) {
  return String(tab.title || tab.url).replace(/\n/g, ' ');
}

// Markdown link text can't contain a literal "[" or "]" without breaking
// the [text](url) syntax -- escaped the same way a table cell escapes "|".
function escapeLinkText(text) {
  return text.replace(/[[\]]/g, '\\$&');
}

// Wraps the URL in <> (CommonMark's escape hatch for a link destination
// with spaces) whenever it contains a space or parenthesis, either of
// which would otherwise be read as the end of the (url) part.
function mdLinkUrl(url) {
  return /[\s()]/.test(url) ? `<${escapeUrlForAngleBrackets(url)}>` : url;
}

function mdLink(tab) {
  return `[${escapeLinkText(plainTitle(tab))}](${mdLinkUrl(tab.url)})`;
}

// Body-only renderers for the fixed-shape styles (everything except the two
// table styles) -- one tab-list per window, heading/collapsible wrapping
// applied uniformly afterwards by renderSimpleMarkdownStyle.
const MARKDOWN_STYLE_BODIES = {
  'numbered-links': (tabs) => tabs.map((tab, idx) => `${idx + 1}. ${mdLink(tab)}`).join('\n'),
  'bulleted-links': (tabs) => tabs.map((tab) => `- ${mdLink(tab)}`).join('\n'),
  checklist: (tabs) => tabs.map((tab) => `- [ ] ${mdLink(tab)}`).join('\n'),
  'title-indented-url': (tabs) => tabs.map((tab, idx) => `${idx + 1}. ${plainTitle(tab)} -\n   ${tab.url}`).join('\n'),
  'bare-urls': (tabs) => tabs.map((tab) => tab.url).join('\n\n'),
  'title-em-dash-url': (tabs) => tabs.map((tab) => `- ${plainTitle(tab)} — ${tab.url}`).join('\n'),
  blockquote: (tabs) => tabs.map((tab) => `**${plainTitle(tab)}**\n> ${tab.url}`).join('\n\n'),
  'heading-per-tab': (tabs) => tabs.map((tab, idx) => `### ${idx + 1}. ${plainTitle(tab)}\n${tab.url}`).join('\n\n')
};

function renderSimpleMarkdownStyle(groups, styleId, collapsible) {
  const bodyFn = MARKDOWN_STYLE_BODIES[styleId];
  return groups.map((tabs, i) => wrapWindowBlock(windowLabel(tabs, i), bodyFn(tabs), collapsible)).join('\n\n');
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

// A plain value for Text output -- Icon never appears here (it's excluded
// from TEXT_FIELD_IDS), so there's no icon/refLabels handling to do.
function plainValue(tab, fieldId, windowIndex) {
  return String(rawFieldValue(tab, fieldId, windowIndex) ?? '').replace(/\n/g, ' ');
}

function withRefDefs(blocks, refLabels) {
  const refDefs = [...refLabels.entries()]
    .map(([url, label]) => `[${label}]: <${escapeUrlForAngleBrackets(url)}>`)
    .join('\n');
  return [...blocks, refDefs].filter(Boolean).join('\n\n');
}

// ---- Table (Grid): one row per tab, columns = chosen fields ----

function renderMarkdownTable(groups, fields, collapsible) {
  const refLabels = new Map();
  const windowBlocks = groups.map((tabs, i) => {
    const header = `| ${fields.map((f) => FIELD_LABELS[f]).join(' | ')} |`;
    // Icon column is center-aligned so an emoji sits where a real favicon
    // image would; other columns stay left-aligned (the default).
    const align = `|${fields.map((f) => (f === 'icon' ? ':---:' : '---')).join('|')}|`;
    const rows = tabs
      .map((tab) => `| ${fields.map((f) => tableCell(tab, f, refLabels, i)).join(' | ')} |`)
      .join('\n');
    return wrapWindowBlock(windowLabel(tabs, i), `${header}\n${align}\n${rows}`, collapsible);
  });
  return withRefDefs(windowBlocks, refLabels);
}

// ---- Table (Card): each tab becomes its own 2-column (Field | Value) mini
// table, stacked under the window heading ----

function renderMarkdownTransposed(groups, fields, collapsible) {
  const refLabels = new Map();
  const windowBlocks = groups.map((tabs, i) => {
    const tabBlocks = tabs.map((tab) => {
      const rows = fields
        .map((f) => `| ${FIELD_LABELS[f]} | ${tableCell(tab, f, refLabels, i)} |`)
        .join('\n');
      return `**${plainTitle(tab)}**\n\n| Field | Value |\n|---|---|\n${rows}`;
    }).join('\n\n');
    return wrapWindowBlock(windowLabel(tabs, i), tabBlocks, collapsible);
  });
  return withRefDefs(windowBlocks, refLabels);
}

// ---- Text list: normal joins the chosen fields onto one line per tab with
// " | " separators; transposed prints one "Field: Value" line per field,
// tabs separated by a blank line. Text has no Style gallery of its own --
// every markdown shape variation now has its own named style instead. ----

function renderTextList(groups, fields, orientation) {
  return groups.map((tabs, i) => {
    const body = orientation === 'transposed'
      ? tabs.map((tab) => fields.map((f) => `${FIELD_LABELS[f]}: ${plainValue(tab, f, i)}`).join('\n')).join('\n\n')
      : tabs.map((tab) => fields.map((f) => plainValue(tab, f, i)).join(' | ')).join('\n');
    return `${windowLabel(tabs, i)}:\n${body}`;
  }).join('\n\n');
}

// Single entry point: dispatches on format, then (for markdown) on Style id.
// settingsForFormat is { fields, style, collapsible } (markdown) or
// { fields, orientation } (text).
export function renderExport(groups, format, settingsForFormat) {
  if (format === 'markdown') {
    const { fields, style, collapsible } = settingsForFormat;
    if (style === 'table-grid') return renderMarkdownTable(groups, fields, collapsible);
    if (style === 'table-card') return renderMarkdownTransposed(groups, fields, collapsible);
    return renderSimpleMarkdownStyle(groups, style, collapsible);
  }
  const { fields, orientation } = settingsForFormat;
  return renderTextList(groups, fields, orientation);
}
