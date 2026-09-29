import { rateLimit } from 'express-rate-limit';
import { logger } from '@librechat/data-schemas';
import type { HubMethods } from '@librechat/data-schemas';
import type { RequestHandler, Response } from 'express';
import type { ServerRequest } from '../types/http';
import { runHubImportJob, HubImportFileTooLargeError } from './importJob';
import { createConfiguredGitArchiveTarget } from './git/config';
import { contextHubRateLimitKey } from './ratelimit';
import { isContextHubEnabled } from './config';
import { UnknownExportError } from './source';

export const CONTEXT_HUB_IMPORT_RATE_WINDOW_MS: number = 15 * 60_000;
export const CONTEXT_HUB_IMPORT_RATE_MAX: number = 10;

/**
 * A dedicated, modest budget: archiving a file is heavier than a read tool
 * call (disk I/O, parsing, one write per thread), and keying by user matches
 * `contextHubMcpLimiter` for the same reason — the route already requires an
 * authenticated session.
 */
export const contextHubImportLimiter: RequestHandler = rateLimit({
  windowMs: CONTEXT_HUB_IMPORT_RATE_WINDOW_MS,
  max: CONTEXT_HUB_IMPORT_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => contextHubRateLimitKey(req as ServerRequest),
});

export interface UploadedFile {
  path: string;
}

export interface CreateContextHubImportHandlerDeps {
  methods: Pick<HubMethods, 'upsertHubThread'>;
}

/**
 * Builds the Express handler for archiving an uploaded export. Gated by
 * `contextHub.enabled` alone — not `contextHub.mcp.enabled` — since an
 * operator can archive conversations into the hub without exposing them
 * over MCP; the two are independent capabilities of the same archive.
 *
 * Authentication is an ordinary user session here (`requireJwtAuth` in the
 * `api/server` route), not the API-key path the MCP endpoint uses: this
 * endpoint is a person uploading their own export through the LibreChat UI,
 * not an external client reading the archive back.
 */
export function createContextHubImportHandler(
  deps: CreateContextHubImportHandlerDeps,
): (req: ServerRequest & { file?: UploadedFile }, res: Response) => Promise<void> {
  const { methods } = deps;

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

    if (!req.file) {
      res.status(400).json({
        error: { message: 'No file was uploaded', type: 'invalid_request_error', code: 'no_file' },
      });
      return;
    }

    try {
      const targets = {
        methods,
        git: createConfiguredGitArchiveTarget(req.config?.contextHub?.git),
      };
      const result = await runHubImportJob({ filepath: req.file.path, userId, targets });
      res.status(201).json({
        message: 'Conversation(s) archived successfully',
        threadCount: result.threadCount,
      });
    } catch (error) {
      if (error instanceof UnknownExportError) {
        res.status(400).json({
          error: {
            message: error.message,
            type: 'invalid_request_error',
            code: 'unsupported_export',
          },
        });
        return;
      }
      if (error instanceof HubImportFileTooLargeError) {
        res.status(413).json({
          error: { message: error.message, type: 'invalid_request_error', code: 'file_too_large' },
        });
        return;
      }
      if (error instanceof SyntaxError) {
        res.status(400).json({
          error: {
            message: 'File is not valid JSON',
            type: 'invalid_request_error',
            code: 'invalid_json',
          },
        });
        return;
      }
      logger.error(`[contextHubImport] user: ${userId} | Error archiving upload:`, error);
      res.status(500).json({
        error: { message: 'Internal server error', type: 'server_error', code: 'internal_error' },
      });
    }
  };
}
