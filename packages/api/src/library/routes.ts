import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { logger, runAsSystem } from '@librechat/data-schemas';
import type { NextFunction, RequestHandler, Response } from 'express';
import type { ServerRequest } from '../types/http';
import type { LibraryService } from './service';
import {
  ParseTimeoutError,
  WorkerBusyError,
  WorkerCrashedError,
  WorkerResultTooLargeError,
  WorkerUnavailableError,
} from './worker/errors';
import { FetchError, TooLargeError, UnsafeUrlError } from './net/safeFetch';
import { isConversationImportError } from '../conversations/import';
import { isContentFilterError } from '../middleware/contentFilter';
import { PdfEncryptedError, PdfError } from './pdf/parsePdf';
import { EpubDrmError, EpubError } from './epub/parseEpub';
import { createHighlightSchema, KINDS, LOCATIONS, SORTS } from './types';
import { contextHubRateLimitKey } from '../hub/ratelimit';
import { isInboxToken, parseInboundEmail } from './inbox';
import { UnsupportedUploadError } from './ingest/upload';
import { convertLibraryDocumentToChat } from './chat';
import { NotReadableError } from './ingest/extract';
import { FeedParseError } from './feed/parseFeed';
import { MAX_OCR_PAGE_CHARS } from './service';
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

/**
 * A newsletter address is a secret in a URL that anyone can try, so every guess is limited by where it
 * comes from, the only thing known before the secret has been checked.
 */
export const libraryInboxLimiter: RequestHandler = rateLimit({
  windowMs: LIBRARY_RATE_WINDOW_MS,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
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
    /** A folder id, or null to take the document out of its folder. */
    folderId: z.string().min(1).max(64).nullable().optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
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

const unitTextSchema = z.object({ text: z.string().max(MAX_OCR_PAGE_CHARS * 2) });

const folderBodySchema = z.object({
  name: z
    .string()
    .transform((name) => name.trim().replace(/\s+/g, ' '))
    .pipe(z.string().min(1).max(64)),
});

const feedBodySchema = z.object({ url: z.string().url().max(2048) });

const reviewBodySchema = z.object({ action: z.enum(['done', 'mute']) });

/** An endpoint or model name as the UI reports it: letters, digits and the punctuation model ids use. */
const NAME_PATTERN = /^[\w.:/@ -]{1,200}$/;

const chatBodySchema = z.object({
  endpoint: z.string().regex(NAME_PATTERN).optional(),
  model: z.string().regex(NAME_PATTERN).optional(),
  /** A chapter or page of a book; leave out for an article or for the book from its start. */
  unitIndex: z.number().int().nonnegative().optional(),
});

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
  listFolders: Handler;
  createFolder: Handler;
  renameFolder: Handler;
  deleteFolder: Handler;
  followFeed: Handler;
  listFeeds: Handler;
  refreshFeed: Handler;
  unfollowFeed: Handler;
  getUnit: Handler;
  getResource: Handler;
  saveUnitText: Handler;
  getSource: Handler;
  exportHighlights: Handler;
  dailyReview: Handler;
  reviewHighlight: Handler;
  chat: Handler;
  getInbox: Handler;
  rotateInbox: Handler;
  deleteInbox: Handler;
  receiveEmail: Handler;
  removeSource: Handler;
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

/**
 * Saves a conversation, already in the shape of an import, through the app's own importer and
 * returns the new conversation's id. Supplied by the caller: the importer lives in `/api`.
 */
export type LibraryChatImporter = (params: {
  userId: string;
  userRole?: string;
  payload: ReturnType<typeof convertLibraryDocumentToChat>;
  req: ServerRequest;
}) => Promise<{ conversationId: string }>;

export function createLibraryHandlers({
  service: source,
  importConversation,
}: {
  service: LibraryServiceSource;
  importConversation?: LibraryChatImporter;
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

  const listFolders: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    res.status(200).json({ folders: await service.listFolders(userId) });
  };

  const createFolder: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const body = folderBodySchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'invalid_request', 'A folder name is required');
    const outcome = await service.createFolder(userId, body.data.name);
    if (outcome.status === 'limit') {
      return fail(res, 409, 'folder_limit', 'You have as many folders as allowed');
    }
    res.status(outcome.status === 'created' ? 201 : 200).json({ folder: outcome.folder });
  };

  const renameFolder: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const body = folderBodySchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'invalid_request', 'A folder name is required');
    const outcome = await service.renameFolder(userId, param(req, 'id'), body.data.name);
    if (outcome.status === 'not_found') return fail(res, 404, 'not_found', 'Folder not found');
    if (outcome.status === 'exists') {
      return fail(res, 409, 'folder_exists', 'A folder with that name already exists');
    }
    res.status(200).json({ folder: outcome.folder });
  };

  const deleteFolder: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const removed = await service.deleteFolder(userId, param(req, 'id'));
    if (!removed) return fail(res, 404, 'not_found', 'Folder not found');
    res.status(204).end();
  };

  const followFeed: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const body = feedBodySchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'invalid_request', 'A valid url is required');
    try {
      const outcome = await service.followFeed(userId, body.data.url);
      if (outcome.status === 'limit') {
        return fail(res, 409, 'feed_limit', 'You are following as many feeds as allowed');
      }
      res.status(outcome.status === 'followed' ? 201 : 200).json(outcome);
    } catch (error) {
      feedFailure(res, error);
    }
  };

  const listFeeds: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    res.status(200).json({ feeds: await service.listFeeds(userId) });
  };

  const refreshFeed: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    try {
      const refresh = await service.refreshFeed(userId, param(req, 'id'));
      if (!refresh) return fail(res, 404, 'not_found', 'Feed not found');
      res.status(200).json({ refresh });
    } catch (error) {
      feedFailure(res, error);
    }
  };

  const unfollowFeed: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const removed = await service.unfollowFeed(userId, param(req, 'id'));
    if (!removed) return fail(res, 404, 'not_found', 'Feed not found');
    res.status(204).end();
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
    const folder = typeof req.query.folder === 'string' ? req.query.folder.trim().slice(0, 64) : '';
    const tag = typeof req.query.tag === 'string' ? req.query.tag.trim().slice(0, 64) : '';
    const kind = KINDS.find((value) => value === req.query.kind);
    const sort = SORTS.find((value) => value === req.query.sort);
    const documents = await service.list(userId, {
      location,
      kind,
      sort,
      tag: tag || undefined,
      folder: folder || undefined,
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

  const getResource: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const path = typeof req.query.path === 'string' ? req.query.path : '';
    const resource = await service.getResource(userId, param(req, 'id'), path);
    if (!resource) return fail(res, 404, 'not_found', 'Image not found');
    // Only raster images are ever stored, typed from their bytes. These headers keep the browser from
    // treating the response as anything else, or running anything it might contain, even if opened directly.
    res.setHeader('Content-Type', resource.mediaType);
    res.setHeader('Content-Length', String(resource.bytes.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.status(200).end(resource.bytes);
  };

  const saveUnitText: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const body = unitTextSchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'invalid_request', 'Text is required');
    const outcome = await service.saveUnitText(
      userId,
      param(req, 'id'),
      Number(param(req, 'index')),
      body.data.text,
    );
    switch (outcome.status) {
      case 'saved':
        res.status(200).json({ unit: outcome.unit, needsOcr: outcome.needsOcr });
        return;
      case 'has_text':
        return fail(res, 409, 'has_text', 'This page already has text');
      case 'empty':
        return fail(res, 422, 'empty_text', 'No text was found on that page');
      default:
        return fail(res, 404, 'not_found', 'Page not found');
    }
  };

  const exportHighlights: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const requested = req.query.format;
    const format = requested === 'csv' || requested === 'markdown' ? requested : undefined;
    if (!format) return fail(res, 400, 'invalid_request', 'format must be markdown or csv');
    const documentId = typeof req.query.documentId === 'string' ? req.query.documentId : undefined;
    const file = await service.exportHighlights(userId, format, documentId);
    if (!file) return fail(res, 404, 'not_found', 'Document not found');
    // A download, never something a browser should display or run, whatever the text contains.
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).end(file.body);
  };

  const getSource: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const bytes = await service.getSource(userId, param(req, 'id'));
    if (!bytes) return fail(res, 404, 'not_found', 'No original file is stored for this document');
    // Only ever a PDF the person uploaded; typed here, never taken from the file. The headers keep a
    // browser from running anything in it if the address is opened directly.
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).end(bytes);
  };

  const removeSource: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const removed = await service.removeSource(userId, param(req, 'id'));
    if (!removed)
      return fail(res, 404, 'not_found', 'No original file is stored for this document');
    res.status(204).end();
  };

  const patch: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const body = patchDocumentSchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'invalid_request', 'Nothing valid to update');
    const document = await service.update(userId, param(req, 'id'), body.data);
    if (!document) return fail(res, 404, 'not_found', 'Document or folder not found');
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

  const dailyReview: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const query = (req.query ?? {}) as Record<string, unknown>;
    const number = (raw: unknown): number | undefined => {
      const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    res.status(200).json(
      await service.dailyReview(userId, {
        offsetMinutes: number(query.offset),
        extra: number(query.extra),
      }),
    );
  };

  const reviewHighlight: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const service = serviceFor(req);
    const body = reviewBodySchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'invalid_request', 'action must be done or mute');
    const found = await service.reviewHighlight(userId, param(req, 'id'), body.data.action);
    if (!found) return fail(res, 404, 'not_found', 'Highlight not found');
    res.status(204).end();
  };

  /** "Ask about this": opens a new chat that starts from the page, article, chapter or book. */
  const chat: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    if (!importConversation) return fail(res, 404, 'not_found', 'Chat is not available');
    const service = serviceFor(req);
    const body = chatBodySchema.safeParse(req.body ?? {});
    if (!body.success) return fail(res, 400, 'invalid_request', 'Invalid request');
    try {
      const found = await service.chatSource(userId, param(req, 'id'), {
        unitIndex: body.data.unitIndex,
      });
      if (!found) return fail(res, 404, 'not_found', 'Document not found');
      if (found.text.trim() === '') {
        return fail(res, 422, 'empty_document', 'There is no text here to ask about');
      }
      const payload = convertLibraryDocumentToChat(found, {
        endpoint: body.data.endpoint,
        model: body.data.model,
      });
      const { conversationId } = await importConversation({
        userId,
        userRole: req.user?.role,
        payload,
        req,
      });
      res.status(201).json({ conversationId });
    } catch (error) {
      if (isContentFilterError(error) || isConversationImportError(error)) {
        res.status(error.statusCode).json(error.body);
        return;
      }
      logger.error('[library] Could not open a chat about a document:', error);
      fail(res, 500, 'internal_error', 'Could not open the chat');
    }
  };

  const getInbox: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const inbox = await serviceFor(req).getInbox(userId);
    res.status(200).json({ inbox: inbox ? { createdAt: inbox.createdAt } : null });
  };

  /** The one time the secret is shown: only its hash is stored. */
  const rotateInbox: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const { token, createdAt } = await serviceFor(req).rotateInbox(userId);
    res.status(201).json({ token, createdAt });
  };

  const deleteInbox: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    await serviceFor(req).deleteInbox(userId);
    res.status(204).end();
  };

  /**
   * What an email service posts for a message sent to someone's newsletter address. The sender is
   * not the person, so nothing about the answer tells a guesser anything: every refusal is a 404.
   */
  const receiveEmail: Handler = async (req, res) => {
    const userId = gate(req, res);
    if (!userId) return;
    const email = parseInboundEmail(req.body);
    if (!email) return fail(res, 422, 'empty_message', 'The message has no text');
    try {
      const result = await serviceFor(req).receiveEmail(userId, email);
      res.status(result.created ? 201 : 200).json({ document: { id: result.document.id } });
    } catch (error) {
      saveFailure(res, error);
    }
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
    listFolders,
    createFolder,
    renameFolder,
    deleteFolder,
    followFeed,
    listFeeds,
    refreshFeed,
    unfollowFeed,
    getUnit,
    getResource,
    saveUnitText,
    getSource,
    exportHighlights,
    dailyReview,
    reviewHighlight,
    chat,
    getInbox,
    rotateInbox,
    deleteInbox,
    receiveEmail,
    removeSource,
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

export interface LibraryInboxAuthDeps {
  /** Whose address a secret is; from the service, which reads across tenants for this one lookup. */
  findOwner: (token: string) => Promise<{ userId: string; tenantId?: string } | null>;
  findUser: (query: { _id: string }) => Promise<Record<string, unknown> | null>;
}

/**
 * Turns the secret in a newsletter address into the person it belongs to, as if they had signed in,
 * so everything after it (config, tenant, handler) works as for any request of theirs. A token that
 * is malformed, unknown, or whose owner is gone gets the same 404.
 */
export function createLibraryInboxAuth({
  findOwner,
  findUser,
}: LibraryInboxAuthDeps): (req: ServerRequest, res: Response, next: NextFunction) => Promise<void> {
  return async (req, res, next) => {
    const token = (req.params as Record<string, unknown> | undefined)?.token;
    if (!isInboxToken(token)) return fail(res, 404, 'not_found', 'Not found');
    try {
      const owner = await findOwner(token);
      const user = owner ? await runAsSystem(async () => findUser({ _id: owner.userId })) : null;
      if (!owner || !user) return fail(res, 404, 'not_found', 'Not found');
      (req as unknown as { user: unknown }).user = { ...user, id: owner.userId };
      next();
    } catch (error) {
      logger.error('[library] Could not look up a newsletter address:', error);
      fail(res, 500, 'internal_error', 'Could not receive the message');
    }
  };
}
