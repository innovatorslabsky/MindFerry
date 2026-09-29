import { rateLimit } from 'express-rate-limit';
import type { HubMethods } from '@librechat/data-schemas';
import type { RequestHandler, Response } from 'express';
import type { ServerRequest } from '../types/http';
import { contextHubRateLimitKey } from './ratelimit';
import { isContextHubEnabled } from './config';

/**
 * Read-only browsing of a user's own archive from MindFerry's own UI — the
 * counterpart to the MCP tools an external client uses, for a person who
 * just wants to look at what's in there without going through an AI. Gated
 * by `contextHub.enabled` alone, like the archive and import routes, since
 * browsing the archive doesn't require exposing it over MCP.
 */

export const CONTEXT_HUB_BROWSE_RATE_WINDOW_MS: number = 60_000;
export const CONTEXT_HUB_BROWSE_RATE_MAX: number = 60;

export const contextHubBrowseLimiter: RequestHandler = rateLimit({
  windowMs: CONTEXT_HUB_BROWSE_RATE_WINDOW_MS,
  max: CONTEXT_HUB_BROWSE_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => contextHubRateLimitKey(req as ServerRequest),
});

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

function clampLimit(raw: unknown): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(parsed, MAX_LIST_LIMIT);
}

function requireUserId(req: ServerRequest, res: Response): string | undefined {
  if (!isContextHubEnabled(req.config)) {
    res.status(404).json({
      error: { message: 'Context hub is not enabled', type: 'not_found', code: 'not_found' },
    });
    return undefined;
  }
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({
      error: {
        message: 'Authentication is required',
        type: 'invalid_request_error',
        code: 'unauthorized',
      },
    });
    return undefined;
  }
  return userId;
}

export interface CreateHubListThreadsHandlerDeps {
  methods: Pick<HubMethods, 'listHubThreads' | 'searchHubThreads'>;
}

/** `GET /api/hub/threads?q=&limit=` — a search term lists matches, its absence lists recent threads. */
export function createHubListThreadsHandler(
  deps: CreateHubListThreadsHandlerDeps,
): (req: ServerRequest, res: Response) => Promise<void> {
  const { methods } = deps;

  return async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
      return;
    }

    const limit = clampLimit(req.query.limit);
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const threads = query
      ? await methods.searchHubThreads(userId, { query, limit })
      : await methods.listHubThreads(userId, limit);

    res.status(200).json({ threads });
  };
}

export interface CreateHubGetThreadHandlerDeps {
  methods: Pick<HubMethods, 'getHubThread'>;
}

type GetThreadRequest = ServerRequest & { params: { id?: string } };

/** `GET /api/hub/threads/:id` — one archived conversation in full. */
export function createHubGetThreadHandler(
  deps: CreateHubGetThreadHandlerDeps,
): (req: GetThreadRequest, res: Response) => Promise<void> {
  const { methods } = deps;

  return async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
      return;
    }

    const id = req.params.id;
    if (!id) {
      res.status(400).json({
        error: { message: 'A thread id is required', type: 'invalid_request_error', code: 'no_id' },
      });
      return;
    }

    const thread = await methods.getHubThread(userId, id);
    if (!thread) {
      res.status(404).json({
        error: {
          message: 'No archived conversation has that id',
          type: 'not_found',
          code: 'thread_not_found',
        },
      });
      return;
    }

    res.status(200).json({ thread });
  };
}

export interface CreateHubListNotesHandlerDeps {
  methods: Pick<HubMethods, 'listHubNotes'>;
}

/** `GET /api/hub/notes?threadId=` — every note, or only those anchored to one thread. */
export function createHubListNotesHandler(
  deps: CreateHubListNotesHandlerDeps,
): (req: ServerRequest, res: Response) => Promise<void> {
  const { methods } = deps;

  return async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
      return;
    }

    const threadId = typeof req.query.threadId === 'string' ? req.query.threadId : undefined;
    const notes = await methods.listHubNotes(userId, threadId);
    res.status(200).json({ notes });
  };
}
