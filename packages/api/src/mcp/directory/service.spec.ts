import type { MCPDirectoryConfig } from 'librechat-data-provider';
import type { MCPDirectoryFetchText } from './service';
import { MCPDirectoryUnavailableError, createMCPDirectoryService } from './service';

const README = `## Server Implementations

### <a name="databases"></a>Databases
- [acme/postgres](https://github.com/acme/postgres) 🏠 - Query PostgreSQL databases.
- [acme/redis](https://github.com/acme/redis) ☁️ - Manage Redis keys.

### <a name="search"></a>Search
- [acme/searx](https://github.com/acme/searx) 🏠 - Metasearch over SearXNG.
`;

const config: NonNullable<MCPDirectoryConfig> = {
  enabled: true,
  sourceUrl: 'https://example.test/README.md',
  cacheTtlMs: 60_000,
  fetchTimeoutMs: 1_000,
  maxSourceBytes: 1_000_000,
};

function setup(fetchText: MCPDirectoryFetchText = jest.fn().mockResolvedValue(README)) {
  const clock = { now: 1_000_000 };
  const service = createMCPDirectoryService({ fetchText, now: () => clock.now });
  return { clock, service, fetchText };
}

describe('createMCPDirectoryService', () => {
  it('filters by every search term across id, name and description', async () => {
    const { service } = setup();
    const result = await service.query(config, { q: 'acme redis' });

    expect(result.entries.map((entry) => entry.id)).toEqual(['acme/redis']);
    expect(result.total).toBe(1);
  });

  it('filters by category and scope together', async () => {
    const { service } = setup();
    const result = await service.query(config, { category: 'databases', scope: 'local' });

    expect(result.entries.map((entry) => entry.id)).toEqual(['acme/postgres']);
  });

  it('reports category counts for the whole listing, not the filtered view', async () => {
    const { service } = setup();
    const result = await service.query(config, { q: 'redis' });

    expect(result.categories).toEqual([
      { id: 'databases', name: 'Databases', count: 2 },
      { id: 'search', name: 'Search', count: 1 },
    ]);
  });

  it('pages with an opaque cursor and omits it on the last page', async () => {
    const { service } = setup();
    const first = await service.query(config, { limit: 2 });
    const second = await service.query(config, { limit: 2, cursor: first.nextCursor });

    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).toBe('2');
    expect(second.entries.map((entry) => entry.id)).toEqual(['acme/searx']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('treats a malformed cursor as the first page and clamps the page size', async () => {
    const { service } = setup();
    const result = await service.query(config, { cursor: 'abc', limit: 10_000 });

    expect(result.entries).toHaveLength(3);
  });

  it('fetches once within the TTL and again after it expires', async () => {
    const { service, clock, fetchText } = setup();
    await service.query(config, {});
    await service.query(config, { q: 'redis' });
    expect(fetchText).toHaveBeenCalledTimes(1);

    clock.now += config.cacheTtlMs + 1;
    await service.query(config, {});
    expect(fetchText).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight fetch between concurrent requests', async () => {
    const { service, fetchText } = setup();
    await Promise.all([service.query(config, {}), service.query(config, { q: 'redis' })]);

    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it('passes the configured timeout and byte cap to the transport', async () => {
    const { service, fetchText } = setup();
    await service.query(config, {});

    expect(fetchText).toHaveBeenCalledWith(config.sourceUrl, {
      timeoutMs: 1_000,
      maxBytes: 1_000_000,
    });
  });

  it('keeps serving the last good snapshot when a refresh fails', async () => {
    const fetchText = jest
      .fn<ReturnType<MCPDirectoryFetchText>, Parameters<MCPDirectoryFetchText>>()
      .mockResolvedValueOnce(README)
      .mockRejectedValueOnce(new Error('network down'));
    const { service, clock } = setup(fetchText);
    await service.query(config, {});

    clock.now += config.cacheTtlMs + 1;
    const result = await service.query(config, {});

    expect(result.total).toBe(3);
  });

  it('raises an unavailable error when there is nothing cached to fall back to', async () => {
    const { service } = setup(jest.fn().mockRejectedValue(new Error('network down')));

    await expect(service.query(config, {})).rejects.toBeInstanceOf(MCPDirectoryUnavailableError);
  });

  it('rejects a source that parses to no servers', async () => {
    const { service } = setup(jest.fn().mockResolvedValue('# Nothing here'));

    await expect(service.query(config, {})).rejects.toBeInstanceOf(MCPDirectoryUnavailableError);
  });
});
