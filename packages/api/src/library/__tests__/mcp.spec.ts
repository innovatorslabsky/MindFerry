import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHubMemoryStore } from '../../hub/mcp/memory';
import { createHubMcpServer } from '../../hub/mcp/server';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { createAnchor } from '../anchor/textQuote';
import { createLibraryService } from '../service';

const para = (s: string) => `<p>${Array.from({ length: 10 }, () => s).join(' ')}</p>`;
const page = (title: string, s: string) =>
  `<html><head><title>${title}</title></head><body><article><h1>${title}</h1>${para(s)}${para('Filler paragraph to keep the article long enough.')}</article></body></html>`;

const textOf = (result: CallToolResult): string => {
  const [first] = result.content;
  return first && first.type === 'text' ? first.text : '';
};

async function connect(withLibrary = true) {
  const fake = createFakeLibraryMethods();
  const service = createLibraryService({ methods: fake.methods });
  const server = createHubMcpServer({
    store: createHubMemoryStore({ threads: [] }),
    library: withLibrary ? { userId: 'u1', service } : undefined,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'library-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, service };
}

const call = async (client: Client, name: string, args: Record<string, unknown>) =>
  (await client.callTool({ name, arguments: args })) as CallToolResult;

describe('library MCP tools', () => {
  it('registers the three read-only tools only when a library is supplied', async () => {
    const withIt = await connect(true);
    const names = (await withIt.client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(['search_library', 'get_document', 'list_highlights']),
    );
    const without = await connect(false);
    const bare = (await without.client.listTools()).tools.map((tool) => tool.name);
    expect(bare).not.toContain('search_library');
    expect(bare).not.toContain('get_document');
    expect(bare).not.toContain('list_highlights');
  });

  it('offers no tool that writes to the library', async () => {
    const { client } = await connect(true);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names.filter((name) => /library|document|highlight/.test(name)).sort()).toEqual([
      'get_document',
      'list_highlights',
      'search_library',
    ]);
  });

  it('searches saved articles and says so when nothing matches', async () => {
    const { client, service } = await connect();
    await service.saveFromHtml(
      'u1',
      'https://example.test/m',
      page('Memory', 'Spacing beats cramming.'),
    );
    const hit = textOf(await call(client, 'search_library', { query: 'cramming' }));
    expect(hit).toContain('Memory');
    expect(hit).toContain('https://example.test/m');
    expect(textOf(await call(client, 'search_library', { query: 'zebra' }))).toContain(
      'No saved article matches',
    );
  });

  it("does not search another user's library", async () => {
    const { client, service } = await connect();
    await service.saveFromHtml(
      'u2',
      'https://example.test/m',
      page('Private', 'Spacing beats cramming.'),
    );
    expect(textOf(await call(client, 'search_library', { query: 'cramming' }))).toContain(
      'No saved article matches',
    );
  });

  it('reads an article in pages and labels it as third-party text', async () => {
    const { client, service } = await connect();
    const saved = await service.saveFromHtml(
      'u1',
      'https://example.test/m',
      page('Memory', 'Spacing beats cramming.'),
    );
    const first = textOf(
      await call(client, 'get_document', { id: saved.document.id, maxChars: 500 }),
    );
    expect(first).toContain('third party');
    expect(first).toContain('Call again with offset 500');
    const rest = textOf(
      await call(client, 'get_document', { id: saved.document.id, offset: 500, maxChars: 100_000 }),
    );
    expect(rest).not.toContain('Call again with offset');
    expect(textOf(await call(client, 'get_document', { id: 'nope' }))).toContain(
      'No saved article',
    );
  });

  it("will not read another user's article by id", async () => {
    const { client, service } = await connect();
    const theirs = await service.saveFromHtml(
      'u2',
      'https://example.test/m',
      page('Private', 'Secret plans.'),
    );
    const out = textOf(await call(client, 'get_document', { id: theirs.document.id }));
    expect(out).toContain('No saved article');
    expect(out).not.toContain('Secret plans');
  });

  it('lists highlights with notes and flags the ones that could not be placed', async () => {
    const { client, service } = await connect();
    const saved = await service.saveFromHtml(
      'u1',
      'https://example.test/m',
      page('Memory', 'Spacing beats cramming.'),
    );
    const doc = (await service.get('u1', saved.document.id))!;
    await service.createHighlight('u1', {
      documentId: doc.id,
      anchor: createAnchor(doc.text, 0, 6),
      contentHash: doc.contentHash,
      note: 'remember this',
    });
    const listed = textOf(await call(client, 'list_highlights', { documentId: doc.id }));
    expect(listed).toContain('remember this');
    expect(listed).toContain(`"${doc.text.slice(0, 6)}"`);
    expect(textOf(await call(client, 'list_highlights', { documentId: 'other' }))).toBe(
      'No highlights found.',
    );
  });
});
