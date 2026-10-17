/**
 * Turns highlights into files a person can keep: Markdown to read or paste into notes, CSV for a
 * spreadsheet. Everything in them (quotes, notes, titles) is text from a web page or the person's own
 * hand, so both formats are built to be safe to open: CSV cells that a spreadsheet would run as a
 * formula are defused, and Markdown quotes cannot escape their block.
 */

export interface ExportDocument {
  id: string;
  title: string;
  byline?: string;
  siteName?: string;
  normalizedUrl: string;
  kind: 'article' | 'pdf' | 'epub';
}

export interface ExportHighlight {
  documentId: string;
  text: string;
  note?: string;
  color: string;
  tags: string[];
  orphaned: boolean;
  unit?: { kind: 'chapter' | 'page'; index: number };
  createdAt: Date;
}

/** Lets Excel read the file as UTF-8. Written as an escape so no editor or formatter can drop it. */
const UTF8_BOM = String.fromCharCode(0xfeff);

export type ExportFormat = 'markdown' | 'csv';

/** Most highlights one export holds. */
export const EXPORT_MAX_HIGHLIGHTS = 10_000;

export function unitLabel(unit?: { kind: 'chapter' | 'page'; index: number }): string {
  if (!unit) {
    return '';
  }
  return `${unit.kind === 'page' ? 'Page' : 'Chapter'} ${unit.index + 1}`;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function webAddress(url: string): string {
  return /^https?:\/\//i.test(url) ? url : '';
}

/**
 * One CSV cell. A cell a spreadsheet would read as a formula (it starts with `=`, `+`, `-`, `@`, a
 * tab or a carriage return) gets a leading apostrophe, which spreadsheets show as plain text, so a
 * hostile page cannot run anything when its highlight is opened in Excel or Sheets.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Highlights of one document first, in the order they were made; documents in title order. */
function grouped(
  documents: ExportDocument[],
  highlights: ExportHighlight[],
): Array<{ document: ExportDocument; highlights: ExportHighlight[] }> {
  const byDocument = new Map<string, ExportHighlight[]>();
  for (const highlight of highlights) {
    byDocument.set(highlight.documentId, [
      ...(byDocument.get(highlight.documentId) ?? []),
      highlight,
    ]);
  }
  return [...documents]
    .filter((document) => byDocument.has(document.id))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((document) => ({
      document,
      highlights: (byDocument.get(document.id) ?? []).sort(
        (a, b) =>
          (a.unit?.index ?? -1) - (b.unit?.index ?? -1) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      ),
    }));
}

export function highlightsToCsv(
  documents: ExportDocument[],
  highlights: ExportHighlight[],
): string {
  const rows = [
    [
      'Highlight',
      'Title',
      'Author',
      'Source',
      'URL',
      'Note',
      'Color',
      'Tags',
      'Location',
      'Date',
      'Not found',
    ],
  ];
  for (const { document, highlights: list } of grouped(documents, highlights)) {
    for (const highlight of list) {
      rows.push([
        highlight.text,
        document.title,
        document.byline ?? '',
        document.siteName ?? '',
        webAddress(document.normalizedUrl),
        highlight.note ?? '',
        highlight.color,
        highlight.tags.join(', '),
        unitLabel(highlight.unit),
        isoDate(highlight.createdAt),
        highlight.orphaned ? 'yes' : '',
      ]);
    }
  }
  // Without the byte order mark Excel misreads Vietnamese and CJK text.
  return `${UTF8_BOM}${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function quote(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
}

export function highlightsToMarkdown(
  documents: ExportDocument[],
  highlights: ExportHighlight[],
): string {
  const sections = grouped(documents, highlights).map(({ document, highlights: list }) => {
    const lines = [`# ${singleLine(document.title)}`];
    const by = [document.byline, document.siteName]
      .filter(Boolean)
      .map((part) => singleLine(part!));
    const url = webAddress(document.normalizedUrl);
    const source = [by.join(' · '), url ? `<${url}>` : ''].filter(Boolean).join(' — ');
    if (source) {
      lines.push('', source);
    }
    for (const highlight of list) {
      const facts = [
        highlight.color,
        unitLabel(highlight.unit),
        highlight.tags.length > 0 ? `tags: ${highlight.tags.join(', ')}` : '',
        isoDate(highlight.createdAt),
        highlight.orphaned ? 'text no longer found on the page' : '',
      ].filter(Boolean);
      lines.push('', quote(highlight.text));
      if (highlight.note) {
        lines.push('', `**Note:** ${singleLine(highlight.note)}`);
      }
      lines.push('', `*${facts.join(' · ')}*`);
    }
    return lines.join('\n');
  });
  return sections.length > 0 ? `${sections.join('\n\n---\n\n')}\n` : '';
}
