import { rateLimit } from 'express-rate-limit';
import { logger } from '@librechat/data-schemas';
import type { RequestHandler, Response } from 'express';
import type { ServerRequest } from '../types/http';
import type { ConversationHubDeps } from './sync';
import { contextHubRateLimitKey } from './ratelimit';
import { saveConversationToHub } from './sync';
import { isContextHubEnabled } from './config';

export const CONTEXT_HUB_ARCHIVE_RATE_WINDOW_MS = 60_000;
export const CONTEXT_HUB_ARCHIVE_RATE_MAX = 30;

export const contextHubArchiveLimiter: RequestHandler = rateLimit({
  windowMs: CONTEXT_HUB_ARCHIVE_RATE_WINDOW_MS,
  max: CONTEXT_HUB_ARCHIVE_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => contextHubRateLimitKey(req as ServerRequest),
});

export type CreateContextHubArchiveHandlerDeps = ConversationHubDeps;

/**
 * Builds the handler behind "Save to MindFerry": converts a
 * conversation the user already owns directly into the canonical archive
 * shape, without a round trip through an export file. `getConvo` is already
 * scoped to `userId` by the caller this repo passes in (`db.getConvo`), so a
 * conversation id for someone else's conversation resolves to nothing rather
 * than leaking across owners.
 */
type ArchiveRequest = ServerRequest & { params: { conversationId?: string } };

export function createContextHubArchiveHandler(
  deps: CreateContextHubArchiveHandlerDeps,
): (req: ArchiveRequest, res: Response) => Promise<void> {
  return async (req, res) => {
    if (!isContextHubEnabled(req.config)) {
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
          code: 'unauthorized',
        },
      });
      return;
    }

    const conversationId = req.params.conversationId;
    if (!conversationId) {
      res.status(400).json({
        error: {
          message: 'A conversation id is required',
          type: 'invalid_request_error',
          code: 'missing_conversation_id',
        },
      });
      return;
    }

    try {
      const saved = await saveConversationToHub(deps, userId, conversationId, req.config);
      if (!saved) {
        res.status(404).json({
          error: {
            message: 'Conversation not found',
            type: 'invalid_request_error',
            code: 'not_found',
          },
        });
        return;
      }

      res.status(201).json({
        message: 'Conversation archived successfully',
        threadId: saved.threadId,
        messageCount: saved.messageCount,
      });
    } catch (error) {
      logger.error(
        `[contextHubArchive] user: ${userId} | Error archiving conversation ${conversationId}:`,
        error,
      );
      res.status(500).json({
        error: { message: 'Internal server error', type: 'server_error', code: 'internal_error' },
      });
    }
  };
}
