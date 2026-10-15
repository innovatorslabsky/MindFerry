import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { logger } from '@librechat/data-schemas';
import type { RequestHandler, Response } from 'express';
import type { ServerRequest } from '../types/http';
import type { LibraryService } from './service';
import { contextHubRateLimitKey } from '../hub/ratelimit';
import { NotReadableError } from './ingest/extract';
import { FetchError, TooLargeError, UnsafeUrlError } from './net/safeFetch';
import { createHighlightSchema, LOCATIONS } from './types';
import { isLibraryEnabled } from './config';

/**
 * HTTP surface of the reading library, for MindFerry's own UI. Every handler is gated by
 * `contextHub.library.enabled` and scoped to the authenticated user; none of them can name another
 * user's document, because the service layer filters every read and write by `userId`.
 */

export const LIBRARY_RATE_WINDOW_MS: number = 60_000;
export const LIBRARY_BROWSE_RATE_MAX: number = 120;
/** Saving by URL makes the server fetch a third-party page, so it is limited much harder. */
export const LIBRARY_SAVE_RATE_MAX: number = 20;

export const libraryBrowseLimiter: RequestHandler = rateLimit({
  windowMs: LIBRARY_RATE_WINDOW_MS,
  max: LIBRARY_BROWSE_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => contextHubRateLimitKey(req as ServerRequest),
});

export const librarySaveLimiter: RequestHandler = rateLimit({
  windowMs: LIBRARY_RATE_WINDOW_MS,
  max: LIBRARY_SAVE_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => contextHubRateLimitKey(req as ServerRequest),
});

/** Largest page a client may hand over directly; the server-side fetch has its own 5 MiB cap. */
export const LIBRARY_MAX_HTML_CHARS = 2_000_000;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const saveBodySchema = z.object({
  url: z.string().url().max(2048),
  /** A page the client already rendered (extension, bookmarklet); skips the server fetch. */
  html: z.string().min(1).max(LIBRARY_MAX_HTML_CHARS).optional(),
  location: z.enum(LOCATIONS).optional(),
});

const patchDocumentSchema = z
  .object({
    location: z.enum(LOCATIONS).optional(),
    tags: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .refine((patch) => patch.location !== undefined || patch.tags !== undefined, {
    message: 'Nothing to update',
  });

const patchHighlightSchema = z
  .object({
    color: z.enum(['yellow', 'blue', 'green', 'red', 'purple']).optional(),
    note: z.string().max(10_000).nullable().optional(),
    tags: z.array(z.string().min(1).max(64)).max(20).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'Nothing to update',
  });

const progressBodySchema = z.object({ textOffset: z.number().int().nonnegative() });

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { message, type: code, code } });
}

function gate(req: ServerRequest, res: Response): string | undefined {
  if (!isLibraryEnabled(req.config)) {
    fail(res, 404, 'not_found', 'The library is not enabled');
    return undefined;
  }
  const userId = req.user?.id;
  if (!userId) {
    fail(res, 401, 'unauthorized', 'Authentication is required');
    return undefined;
  }
  return userId;
}

function clampLimit(raw: unknown): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function clampSkip(raw: unknown): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100_000) : 0;
}

function param(req: ServerRequest, name: string): string {
  const value = (req.params as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : '';
}

/** Maps what saving a URL can throw onto a status the UI can show; anything else is a 500. */
function saveFailure(res: Response, error: unknown): void {
  if (error instanceof UnsafeUrlError) {
    return fail(res, 400, 'unsafe_url', error.message);
  }
  if (error instanceof TooLargeError) {
    return fail(res, 413, 'too_large', 'The page is too large to save');
  }
  if (error instanceof NotReadableError) {
    return fail(res, 422, 'not_readable', 'No readable article was found on that page');
  }
  if (error instanceof FetchError) {
    return fail(res, 502, 'fetch_failed', error.message);
  }
  logger.error('[library] Unexpected error saving a page:', error);
  return fail(res, 500, 'internal_error', 'Could not save the page');
}

type Handler = (req: ServerRequest, res: Response) => Promise<void>;

export function createLibraryHandlers({ service }: { service: LibraryService }) {
  const save: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const body = saveBodySchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'invalid_request', 'A valid url is required');
    const { url, html, location } = body.data;
    try {
      const result = html
        ? await service.saveFromHtml(userId, url, html, location)
        : await service.saveFromUrl(userId, url, location);
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      saveFailure(res, error);
    }
  };

  const list: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const limit = clampLimit(req.query.limit);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      res.status(200).json({ documents: await service.search(userId, q, limit) });
      return;
    }
    const location = LOCATIONS.find((value) => value === req.query.location);
    const documents = await service.list(userId, {
      location,
      limit,
      skip: clampSkip(req.query.skip),
    });
    res.status(200).json({ documents });
  };

  const get: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const id = param(req, 'id');
    const [document, highlights, progress] = await Promise.all([
      service.get(userId, id),
      service.listHighlights(userId, id),
      service.getProgress(userId, id),
    ]);
    if (!document) return fail(res, 404, 'not_found', 'Document not found');
    res.status(200).json({ document, highlights, progress });
  };

  const patch: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const body = patchDocumentSchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'invalid_request', 'Nothing valid to update');
    const document = await service.update(userId, param(req, 'id'), body.data);
    if (!document) return fail(res, 404, 'not_found', 'Document not found');
    res.status(200).json({ document });
  };

  const remove: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const removed = await service.remove(userId, param(req, 'id'));
    if (!removed) return fail(res, 404, 'not_found', 'Document not found');
    res.status(204).end();
  };

  const createHighlight: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const body = createHighlightSchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'invalid_request', 'Invalid highlight');
    const outcome = await service.createHighlight(userId, body.data);
    switch (outcome.status) {
      case 'created':
        res.status(201).json({ highlight: outcome.highlight });
        return;
      case 'not_found':
        return fail(res, 404, 'not_found', 'Document not found');
      case 'stale':
        return fail(res, 409, 'stale_content', 'The page changed; reload it and select again');
      default:
        return fail(res, 422, 'anchor_mismatch', 'The selection does not match the page text');
    }
  };

  const patchHighlight: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const body = patchHighlightSchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'invalid_request', 'Nothing valid to update');
    const highlight = await service.updateHighlight(userId, param(req, 'id'), body.data);
    if (!highlight) return fail(res, 404, 'not_found', 'Highlight not found');
    res.status(200).json({ highlight });
  };

  const removeHighlight: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const removed = await service.removeHighlight(userId, param(req, 'id'));
    if (!removed) return fail(res, 404, 'not_found', 'Highlight not found');
    res.status(204).end();
  };

  const setProgress: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const body = progressBodySchema.safeParse(req.body);
    if (!body.success)
      return fail(res, 400, 'invalid_request', 'textOffset must be a whole number');
    const progress = await service.setProgress(userId, param(req, 'id'), body.data.textOffset);
    if (!progress) return fail(res, 404, 'not_found', 'Document not found');
    res.status(200).json({ progress });
  };

  return {
    save,
    list,
    get,
    patch,
    remove,
    createHighlight,
    patchHighlight,
    removeHighlight,
    setProgress,
  };
}
