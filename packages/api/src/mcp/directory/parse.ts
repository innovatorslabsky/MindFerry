import type { MCPDirectoryEntry, MCPDirectoryScope } from 'librechat-data-provider';

const SECTION_HEADING = /^## /;
const SERVER_SECTION = /^## Server Implementations\b/;
const CATEGORY_HEADING = /^### .*?<a name="([^"]+)"><\/a>\s*(.+?)\s*$/;
const ENTRY = /^- \[([^\]]+)\]\((https?:\/\/[^)\s]+)\)(.*)$/;
const BADGE = /\s*\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g;
const GITHUB_REPO = /^https?:\/\/github\.com\/([^/\s]+\/[^/\s#?]+)/i;

const SCOPE_MARKERS: ReadonlyArray<readonly [string, MCPDirectoryScope]> = [
  ['☁', 'cloud'],
  ['🏠', 'local'],
  ['📟', 'embedded'],
];
const OFFICIAL_MARKER = '🎖';

function parseScopes(flags: string): MCPDirectoryScope[] {
  return SCOPE_MARKERS.filter(([marker]) => flags.includes(marker)).map(([, scope]) => scope);
}

function parseEntry(
  line: string,
  categoryId: string,
  categoryName: string,
): MCPDirectoryEntry | undefined {
  const match = ENTRY.exec(line);
  if (!match) {
    return undefined;
  }
  const [, name, repoUrl, rest] = match;
  const body = rest.replace(BADGE, '');
  const separator = body.indexOf(' - ');
  const flags = separator === -1 ? body : body.slice(0, separator);
  const description = separator === -1 ? '' : body.slice(separator + 3).trim();
  const repo = GITHUB_REPO.exec(repoUrl);

  return {
    id: repo ? repo[1] : name,
    name,
    repoUrl,
    description,
    categoryId,
    categoryName,
    scopes: parseScopes(flags),
    official: flags.includes(OFFICIAL_MARKER),
  };
}

/**
 * Parses the awesome-mcp-servers README layout: `###` category headings
 * carrying an `<a name>` slug, each followed by `- [name](url) … - description`
 * bullets. Entries outside the "Server Implementations" section, or before the
 * first category, are not servers and are skipped. A repeated `id` keeps the
 * first listing.
 */
export function parseMCPDirectory(markdown: string): MCPDirectoryEntry[] {
  const seen = new Set<string>();
  const entries: MCPDirectoryEntry[] = [];
  let inServers = false;
  let categoryId = '';
  let categoryName = '';

  for (const line of markdown.split(/\r?\n/)) {
    if (SECTION_HEADING.test(line)) {
      inServers = SERVER_SECTION.test(line);
      categoryId = '';
      continue;
    }
    if (!inServers) {
      continue;
    }
    const category = CATEGORY_HEADING.exec(line);
    if (category) {
      categoryId = category[1];
      categoryName = category[2];
      continue;
    }
    if (!categoryId) {
      continue;
    }
    const entry = parseEntry(line, categoryId, categoryName);
    if (!entry || seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    entries.push(entry);
  }

  return entries;
}
