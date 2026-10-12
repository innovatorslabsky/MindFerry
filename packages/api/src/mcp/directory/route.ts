import { logger } from '@librechat/data-schemas';
import { mcpDirectorySchema } from 'librechat-data-provider';
import type { MCPDirectoryParams, MCPDirectoryScope } from 'librechat-data-provider';
import type { RequestHandler, Response } from 'express';
import type { ServerRequest } from '../../types/http';
import type { MCPDirectoryService } from './service';
import { MCPDirectoryUnavailableError } from './service';

const SCOPES: readonly MCPDirectoryScope[] = ['cloud', 'local', 'embedded'];

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function parseParams(query: ServerRequest['query']): MCPDirectoryParams {
  const limit = firstString(query.limit);
  const scope = SCOPES.find((candidate) => candidate === query.scope);
  return {
    q: firstString(query.q),
    category: firstString(query.category),
    cursor: firstString(query.cursor),
    limit: limit ? Number.parseInt(limit, 10) : undefined,
    scope,
  };
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { message, type: code, code } });
}

export interface CreateMCPDirectoryHandlerDeps {
  service: MCPDirectoryService;
}

/**
 * `GET /api/mcp/directory` — read-only search over the configured
 * awesome-mcp-servers–format listing. Gated by `mcpDirectory.enabled`, which
 * defaults off, so an unconfigured deployment answers 404 and makes no
 * outbound request.
 */
export function createMCPDirectoryHandler({
  service,
}: CreateMCPDirectoryHandlerDeps): RequestHandler {
  return async (req, res) => {
    const request = req as ServerRequest;
    const parsed = mcpDirectorySchema.safeParse(request.config?.config?.mcpDirectory ?? {});
    const config = parsed.success ? parsed.data : undefined;
    if (!config?.enabled) {
      return sendError(res, 404, 'not_found', 'The MCP directory is not enabled');
    }
    try {
      return res.json(await service.query(config, parseParams(request.query)));
    } catch (error) {
      logger.warn('[MCPDirectory] Listing unavailable', error);
      const message =
        error instanceof MCPDirectoryUnavailableError ? error.message : 'Directory unavailable';
      return sendError(res, 502, 'directory_unavailable', message);
    }
  };
}
