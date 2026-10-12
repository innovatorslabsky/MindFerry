import { parseMCPDirectory } from './parse';

const README = `# Awesome MCP Servers

## Clients
- [not-a-server](https://example.com/client) 🏠 - Listed under Clients, so skipped.

## Server Implementations

- [🔗 - Aggregators](#aggregators)

### 🔗 <a name="aggregators"></a>Aggregators

Servers for accessing many apps and tools through a single MCP server.
- [402signalhq/402signal](https://github.com/402signalhq/402signal) [![402Signal MCP server](https://glama.ai/mcp/servers/402signalhq/402signal/badges/score.svg)](https://glama.ai/mcp/servers/402signalhq/402signal) 🐍 ☁️ - Checks live x402 payment routes.
- [1mcp/agent](https://github.com/1mcp-app/agent) 📇 ☁️ 🏠 🍎 🪟 🐧 - Aggregates multiple MCP servers into one.

### <a name="bio"></a>Biology, Medicine and Bioinformatics

- [mcpqueen/mcpqueen](https://github.com/mcpqueen/mcpqueen) 🎖️ 📇 ☁️ - Graded MCP registry - live-probes remote servers.
- [vendor/sensor](https://example.com/sensor) 📟 - Embedded sensor bridge.
- [1mcp/agent](https://github.com/1mcp-app/agent) 📇 - Duplicate of an earlier entry.

## Tutorials
- [tutorial/entry](https://example.com/tutorial) - Not a server.
`;

describe('parseMCPDirectory', () => {
  const entries = parseMCPDirectory(README);

  it('reads only the server section and keeps the first of a repeated repository', () => {
    expect(entries.map((entry) => entry.id)).toEqual([
      '402signalhq/402signal',
      '1mcp-app/agent',
      'mcpqueen/mcpqueen',
      'vendor/sensor',
    ]);
    expect(entries.find((entry) => entry.id === '1mcp-app/agent')?.categoryId).toBe('aggregators');
  });

  it('assigns each entry the category heading above it, with or without an emoji', () => {
    expect(entries[0]).toMatchObject({ categoryId: 'aggregators', categoryName: 'Aggregators' });
    expect(entries[2]).toMatchObject({
      categoryId: 'bio',
      categoryName: 'Biology, Medicine and Bioinformatics',
    });
  });

  it('drops the glama badge and keeps the description after the flag run', () => {
    expect(entries[0]).toMatchObject({
      name: '402signalhq/402signal',
      repoUrl: 'https://github.com/402signalhq/402signal',
      description: 'Checks live x402 payment routes.',
    });
  });

  it('keeps hyphens inside a description intact', () => {
    expect(entries[2].description).toBe('Graded MCP registry - live-probes remote servers.');
  });

  it('reads scope and official markers from the flags', () => {
    expect(entries[0].scopes).toEqual(['cloud']);
    expect(entries[1].scopes).toEqual(['cloud', 'local']);
    expect(entries[2]).toMatchObject({ scopes: ['cloud'], official: true });
    expect(entries[3].scopes).toEqual(['embedded']);
    expect(entries[0].official).toBe(false);
  });

  it('falls back to the link text as the id for a non-GitHub repository', () => {
    expect(entries[3]).toMatchObject({
      id: 'vendor/sensor',
      repoUrl: 'https://example.com/sensor',
    });
  });

  it('returns an empty list for a document with no server section', () => {
    expect(parseMCPDirectory('# Title\n\nJust prose.')).toEqual([]);
  });
});
