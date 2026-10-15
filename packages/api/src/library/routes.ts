import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { logger } from '@librechat/data-schemas';
import type { RequestHandler, Response } from 'express';
import type { ServerRequest } from '../types/http';
import type { LibraryService } from './service';
import { contextHubRateLimitKey } from '../hub/ratelimit';
import { NotReadableError } from './ingest/extract';
import { UnsupportedUploadError } from './ingest/upload';
import { EpubDrmError, EpubError } from './epub/parseEpub';
import { PdfEncryptedError, PdfError } from './pdf/parsePdf';
import { FeedParseError } from './feed/parseFeed';
import {
  ParseTimeoutError,
  WorkerBusyError,
  WorkerCrashedError,
  WorkerResultTooLargeError,
  WorkerUnavailableError,
} from './worker/errors';
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

const progressBodySchema = z.object({
  textOffset: z.number().int().nonnegative(),
  /** The chapter or page the offset is in; required for a book, refused for an article. */
  unitIndex: z.number().int().nonnegative().optional(),
});

const feedBodySchema = z.object({ url: z.string().url().max(2048) });

/** Largest upload accepted; also the ceiling the route's multer instance is configured with. */
export const LIBRARY_MAX_UPLOAD_BYTES: number = 50 * 1024 * 1024;

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
  if (isolationFailure(res, error)) {
    return;
  }
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

/** Failures of the isolated parser itself, shared by everything that parses untrusted input. */
function isolationFailure(res: Response, error: unknown): boolean {
  if (error instanceof WorkerBusyError) {
    res.setHeader?.('Retry-After', '5');
    fail(res, 503, 'busy', 'The reader is busy; try again in a few seconds');
    return true;
  }
  if (error instanceof ParseTimeoutError) {
    fail(res, 422, 'timeout', 'Reading this took too long and was stopped');
    return true;
  }
  if (error instanceof WorkerResultTooLargeError) {
    fail(res, 413, 'too_large', 'This is too large to read');
    return true;
  }
  if (error instanceof WorkerCrashedError) {
    logger.warn('[library] The parser stopped while reading an input:', error.message);
    fail(res, 422, 'unreadable_file', 'This could not be read');
    return true;
  }
  if (error instanceof WorkerUnavailableError) {
    logger.error('[library] The isolated parser is unavailable:', error.message);
    fail(res, 503, 'unavailable', 'Saving is unavailable right now');
    return true;
  }
  return false;
}

type Handler = (req: ServerRequest, res: Response) => Promise<void>;

type UploadedRequest = ServerRequest & { file?: { buffer?: Uint8Array; size?: number } };

function uploadFailure(res: Response, error: unknown): void {
  if (isolationFailure(res, error)) {
    return;
  }
  if (error instanceof UnsupportedUploadError) {
    return fail(res, 415, 'unsupported_file', error.message);
  }
  if (error instanceof PdfEncryptedError) {
    return fail(res, 422, 'encrypted', 'This PDF needs a password, which MindFerry cannot use');
  }
  if (error instanceof EpubDrmError) {
    return fail(res, 422, 'drm', 'This EPUB is protected by DRM and cannot be read');
  }
  if (error instanceof PdfError || error instanceof EpubError) {
    return fail(res, 422, 'unreadable_file', error.message);
  }
  logger.error('[library] Unexpected error reading an upload:', error);
  return fail(res, 500, 'internal_error', 'Could not read the file');
}

function feedFailure(res: Response, error: unknown): void {
  if (isolationFailure(res, error)) {
    return;
  }
  if (error instanceof UnsafeUrlError) {
    return fail(res, 400, 'unsafe_url', error.message);
  }
  if (error instanceof FeedParseError) {
    return fail(res, 422, 'not_a_feed', error.message);
  }
  if (error instanceof TooLargeError) {
    return fail(res, 413, 'too_large', 'The feed is too large');
  }
  if (error instanceof FetchError) {
    return fail(res, 502, 'fetch_failed', error.message);
  }
  logger.error('[library] Unexpected error reading a feed:', error);
  return fail(res, 500, 'internal_error', 'Could not read the feed');
}

export interface LibraryHandlers {
  save: Handler;
  upload: Handler;
  previewFeed: Handler;
  getUnit: Handler;
  list: Handler;
  get: Handler;
  patch: Handler;
  remove: Handler;
  createHighlight: Handler;
  patchHighlight: Handler;
  removeHighlight: Handler;
  setProgress: Handler;
}

/** A service, or a function that picks one per request (so isolation settings can follow the config). */
export type LibraryServiceSource = LibraryService | ((req: ServerRequest) => LibraryService);

export function createLibraryHandlers({
  service: source,
}: {
  service: LibraryServiceSource;
}): LibraryHandlers {
  // Resolved once per request by the handler's first use; a plain service is used as is.
  const serviceFor = (req: ServerRequest): LibraryService =>
    typeof source === 'function' ? source(req) : source;

  const save: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
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

  const upload: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const bytes = (req as UploadedRequest).file?.buffer;
    if (!bytes || bytes.length === 0) {
      return fail(res, 400, 'invalid_request', 'A file is required');
    }
    const requested = (req.body as { location?: unknown } | undefined)?.location;
    const location = LOCATIONS.find((value) => value === requested);
    try {
      const result = await service.saveUpload(userId, bytes, location);
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      uploadFailure(res, error);
    }
  };

  const previewFeed: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const body = feedBodySchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'invalid_request', 'A valid url is required');
    try {
      res.status(200).json({ feed: await service.previewFeed(body.data.url) });
    } catch (error) {
      feedFailure(res, error);
    }
  };

  const list: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
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
    const service = serviceFor(req);
    const id = param(req, 'id');
    const [document, highlights, progress] = await Promise.all([
      service.get(userId, id),
      service.listHighlights(userId, id),
      service.getProgress(userId, id),
    ]);
    if (!document) return fail(res, 404, 'not_found', 'Document not found');
    if (document.kind === 'article') {
      res.status(200).json({ document, highlights, progress });
      return;
    }
    // A book's text is read a chapter or page at a time, not shipped whole with its listing.
    const { text: _text, contentHtml: _html, ...summary } = document;
    const units = await service.listUnits(userId, id);
    res.status(200).json({ document: summary, units, highlights, progress });
  };

  const getUnit: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const documentId = param(req, 'id');
    const index = Number(param(req, 'index'));
    const unit = await service.getUnit(userId, documentId, index);
    if (!unit) return fail(res, 404, 'not_found', 'Chapter or page not found');
    const highlights = (await service.listHighlights(userId, documentId)).filter(
      (highlight) => highlight.unit?.index === index,
    );
    res.status(200).json({ unit, highlights });
  };

  const patch: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const body = patchDocumentSchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'invalid_request', 'Nothing valid to update');
    const document = await service.update(userId, param(req, 'id'), body.data);
    if (!document) return fail(res, 404, 'not_found', 'Document not found');
    res.status(200).json({ document });
  };

  const remove: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const removed = await service.remove(userId, param(req, 'id'));
    if (!removed) return fail(res, 404, 'not_found', 'Document not found');
    res.status(204).end();
  };

  const createHighlight: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
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
    const service = serviceFor(req);
    const body = patchHighlightSchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'invalid_request', 'Nothing valid to update');
    const highlight = await service.updateHighlight(userId, param(req, 'id'), body.data);
    if (!highlight) return fail(res, 404, 'not_found', 'Highlight not found');
    res.status(200).json({ highlight });
  };

  const removeHighlight: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const removed = await service.removeHighlight(userId, param(req, 'id'));
    if (!removed) return fail(res, 404, 'not_found', 'Highlight not found');
    res.status(204).end();
  };

  const setProgress: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const body = progressBodySchema.safeParse(req.body);
    if (!body.success)
      return fail(res, 400, 'invalid_request', 'textOffset must be a whole number');
    const progress = await service.setProgress(
      userId,
      param(req, 'id'),
      body.data.textOffset,
      body.data.unitIndex,
    );
    if (!progress) return fail(res, 404, 'not_found', 'Document or position not found');
    res.status(200).json({ progress });
  };

  return {
    save,
    upload,
    previewFeed,
    getUnit,
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
