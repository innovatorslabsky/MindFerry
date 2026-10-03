import { rateLimit } from 'express-rate-limit';
import { logger } from '@librechat/data-schemas';
import { extractEnvVariable } from 'librechat-data-provider';
import type { ContextHubSemanticSearchConfig } from 'librechat-data-provider';
import type { RequestHandler, Response } from 'express';
import type { HubStoreMethods, HubSemanticSearchOptions } from './mongoStore';
import type { CreateHubOpenInChatDeps, HubOpenInChat } from './chat';
import type { ServerRequest } from '../../types/http';
import { createOpenAICompatEmbeddingProvider } from './embeddings';
import { contextHubRateLimitKey } from '../ratelimit';
import { createHubMongoStore } from './mongoStore';
import { isContextHubMcpEnabled } from '../config';
import { createHubOpenInChat } from './chat';
import { handleHubMcpRequest } from './http';

export { isContextHubMcpEnabled };

export const CONTEXT_HUB_MCP_RATE_WINDOW_MS = 60_000;
export const CONTEXT_HUB_MCP_RATE_MAX = 120;

/**
 * Scoped by authenticated user, not by IP: the route is reached only with a
 * valid API key, and IP is the wrong signal once a bearer credential already
 * identifies the caller — a shared IP should not throttle unrelated users,
 * and a compromised key should not be able to hide behind IP rotation.
 */
export function contextHubMcpRateLimitKey(req: ServerRequest): string {
  return contextHubRateLimitKey(req);
}

export const contextHubMcpLimiter: RequestHandler = rateLimit({
  windowMs: CONTEXT_HUB_MCP_RATE_WINDOW_MS,
  max: CONTEXT_HUB_MCP_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => contextHubMcpRateLimitKey(req as ServerRequest),
});

export interface CreateContextHubMcpHandlerDeps {
  methods: HubStoreMethods;
  /**
   * The app's conversation importer, which `open_in_chat` saves through. The
   * tool is offered only when this is supplied and `contextHub.mcp.allowChatImport` is on.
   */
  importConversation?: CreateHubOpenInChatDeps['importConversation'];
  /** The app's public origin, so `open_in_chat` can link to the chat it made. */
  clientOrigin?: string;
}

/**
 * Builds the `HubSemanticSearchOptions` a request's config asks for, or
 * `undefined` when semantic search isn't configured or is switched off —
 * `createHubMongoStore` treats `undefined` as "behave exactly as before this
 * option existed," so this is the only place that decision gets made.
 */
export function buildSemanticSearchOptions(
  config: ContextHubSemanticSearchConfig | undefined,
): HubSemanticSearchOptions | undefined {
  if (!config?.enabled) {
    return undefined;
  }
  return {
    provider: createOpenAICompatEmbeddingProvider({
      baseURL: config.baseURL,
      apiKey: extractEnvVariable(config.apiKey),
      model: config.model,
    }),
    weight: config.weight,
    candidatePoolSize: config.candidatePoolSize,
  };
}

/**
 * `open_in_chat`'s implementation for one request, or `undefined` — leaving
 * the tool unregistered — unless the operator turned it on and the caller
 * supplied an importer to save through.
 */
export function buildOpenInChat(
  deps: Omit<CreateHubOpenInChatDeps, 'importConversation'> &
    Pick<CreateContextHubMcpHandlerDeps, 'importConversation'>,
  allowChatImport: boolean | undefined,
  req: ServerRequest & { user: { id: string; role?: string } },
): HubOpenInChat | undefined {
  const { importConversation } = deps;
  if (!allowChatImport || !importConversation) {
    return undefined;
  }
  return createHubOpenInChat({ ...deps, importConversation }, req);
}

/**
 * Builds the Express handler for the hub's MCP endpoint. Everything that
 * decides *whether* and *how* to serve the request — the feature gate, the
 * per-user store, the tool configuration — lives here; the route file in
 * `api/server` only wires authentication middleware and mounts this handler,
 * per this repo's rule that `/api` holds wiring, not behavior.
 *
 * Authentication (resolving `req.user` from the caller's API key) and the
 * config gate both run upstream of this handler, in that order: an invalid
 * key is rejected before the handler ever runs, so a caller without a valid
 * key learns nothing about whether the feature is even enabled.
 */
export function createContextHubMcpHandler(
  deps: CreateContextHubMcpHandlerDeps,
): (req: ServerRequest, res: Response) => Promise<void> {
  const { methods, importConversation, clientOrigin } = deps;

  return async (req, res) => {
    if (!isContextHubMcpEnabled(req.config)) {
      res.status(404).json({
        error: { message: 'Context hub is not enabled', type: 'not_found', code: 'not_found' },
      });
      return;
    }

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        error: {
          message: 'Authentication is required',
          type: 'invalid_request_error',
          code: 'missing_api_key',
        },
      });
      return;
    }

    const mcpConfig = req.config?.contextHub?.mcp;
    const semanticSearch = buildSemanticSearchOptions(mcpConfig?.semanticSearch);
    const store = createHubMongoStore({ methods, userId, semanticSearch });
    const openInChat = buildOpenInChat(
      { methods, importConversation, clientOrigin },
      mcpConfig?.allowChatImport,
      req as ServerRequest & { user: { id: string; role?: string } },
    );

    try {
      await handleHubMcpRequest({
        req,
        res,
        body: req.body,
        options: {
          store,
          searchLimit: mcpConfig?.searchLimit,
          snippetLength: mcpConfig?.snippetLength,
          allowNotes: mcpConfig?.allowNotes,
          allowArchive: mcpConfig?.allowArchive,
          maxArchiveBytes: mcpConfig?.maxArchiveBytes,
          openInChat,
        },
      });
    } catch (error) {
      logger.error('[contextHubMcp] Error handling request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          error: { message: 'Internal server error', type: 'server_error', code: 'internal_error' },
        });
      }
    }
  };
}
