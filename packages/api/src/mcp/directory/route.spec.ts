import type { MCPDirectoryResponse } from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { MCPDirectoryService } from './service';
import { MCPDirectoryUnavailableError } from './service';
import { createMCPDirectoryHandler } from './route';

const listing: MCPDirectoryResponse = {
  entries: [],
  total: 0,
  categories: [],
  sourceUrl: 'https://example.test/README.md',
  fetchedAt: '2026-10-12T00:00:00.000Z',
};

async function run(
  service: MCPDirectoryService,
  options: { directory?: Record<string, unknown>; query?: Record<string, string> } = {},
) {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const req = {
    query: options.query ?? {},
    config: { config: { mcpDirectory: options.directory } },
  } as unknown as Request;
  await createMCPDirectoryHandler({ service })(req, res, jest.fn());
  return res;
}

describe('createMCPDirectoryHandler', () => {
  it('answers 404 and never touches the service while the directory is disabled', async () => {
    const service = { query: jest.fn() };
    const res = await run(service);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(service.query).not.toHaveBeenCalled();
  });

  it('applies config defaults and forwards only recognised query parameters', async () => {
    const service = { query: jest.fn().mockResolvedValue(listing) };
    const res = await run(service, {
      directory: { enabled: true },
      query: { q: 'redis', scope: 'cloud', limit: '5', cursor: '10', category: 'databases' },
    });

    expect(service.query).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, cacheTtlMs: 24 * 60 * 60_000 }),
      { q: 'redis', scope: 'cloud', limit: 5, cursor: '10', category: 'databases' },
    );
    expect(res.json).toHaveBeenCalledWith(listing);
  });

  it('drops a scope it does not recognise', async () => {
    const service = { query: jest.fn().mockResolvedValue(listing) };
    await run(service, { directory: { enabled: true }, query: { scope: 'orbital' } });

    expect(service.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: undefined }),
    );
  });

  it('answers 502 when the source is unavailable', async () => {
    const service = {
      query: jest.fn().mockRejectedValue(new MCPDirectoryUnavailableError('no servers')),
    };
    const res = await run(service, { directory: { enabled: true } });

    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('treats an invalid directory config as disabled', async () => {
    const service = { query: jest.fn() };
    const res = await run(service, { directory: { enabled: true, sourceUrl: 'not a url' } });

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
