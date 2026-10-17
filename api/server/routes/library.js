const multer = require('multer');
const express = require('express');
const {
  createLibraryService,
  createLibraryIngest,
  getLibraryIsolation,
  getLibraryKeepPdfOriginals,
  getLibraryAutoTag,
  createLibraryHandlers,
  libraryBrowseLimiter,
  librarySaveLimiter,
  LIBRARY_MAX_UPLOAD_BYTES,
} = require('@librechat/api');
const { configMiddleware, requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

/**
 * The reading library: save an article by URL (or from HTML a client already holds), read it,
 * highlight it, and resume where you left off. Every route is a normal signed-in session, runs
 * `configMiddleware` first so the handler can read `contextHub.library.enabled`, and is scoped to
 * the caller in the service layer. Saving by URL makes the server fetch a third-party page, so it
 * has its own, much stricter rate limit than the read routes.
 */
/**
 * Untrusted pages, files and feeds are parsed in a restricted child process (see
 * `contextHub.library.isolation`). The parsers for one set of isolation settings are built once and
 * reused, so concurrency limits hold across requests; a change of settings builds a new set.
 */
const serviceBySettings = new Map();

function serviceFor(req) {
  const isolation = getLibraryIsolation(req.config);
  const keepPdfOriginals = getLibraryKeepPdfOriginals(req.config);
  const autoTag = getLibraryAutoTag(req.config);
  const key = JSON.stringify({ isolation, keepPdfOriginals, autoTag });
  let service = serviceBySettings.get(key);
  if (!service) {
    service = createLibraryService({
      methods: db,
      ingest: createLibraryIngest(isolation),
      keepPdfOriginals,
      autoTag,
    });
    serviceBySettings.set(key, service);
  }
  return service;
}

const handlers = createLibraryHandlers({ service: serviceFor });

const browse = [requireJwtAuth, configMiddleware, libraryBrowseLimiter];
const save = [requireJwtAuth, configMiddleware, librarySaveLimiter];

/**
 * A PDF or EPUB, held in memory only long enough to parse it: the file itself is not kept (unless
 * `contextHub.library.keepPdfOriginals` is on, for PDFs), just the text and chapters taken from it. The type is decided from the bytes, never from the file name or
 * the declared MIME type, so there is no file filter here.
 */
const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIBRARY_MAX_UPLOAD_BYTES, files: 1 },
}).single('file');

function handleUpload(req, res, next) {
  uploadSingle(req, res, (err) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: {
          message: 'File exceeds the maximum allowed size',
          type: 'too_large',
          code: 'too_large',
        },
      });
    }
    if (err) {
      return res.status(400).json({
        error: {
          message: 'Could not read the upload',
          type: 'invalid_request',
          code: 'invalid_request',
        },
      });
    }
    next();
  });
}

router.post('/documents', ...save, handlers.save);
router.post(
  '/uploads',
  requireJwtAuth,
  configMiddleware,
  librarySaveLimiter,
  handleUpload,
  handlers.upload,
);
router.post('/feeds/preview', ...save, handlers.previewFeed);
router.get('/export', ...browse, handlers.exportHighlights);
router.get('/folders', ...browse, handlers.listFolders);
router.post('/folders', ...browse, handlers.createFolder);
router.patch('/folders/:id', ...browse, handlers.renameFolder);
router.delete('/folders/:id', ...browse, handlers.deleteFolder);
router.post('/feeds', ...save, handlers.followFeed);
router.get('/feeds', ...browse, handlers.listFeeds);
router.post('/feeds/:id/refresh', ...save, handlers.refreshFeed);
router.delete('/feeds/:id', ...browse, handlers.unfollowFeed);
router.get('/documents', ...browse, handlers.list);
router.get('/documents/:id', ...browse, handlers.get);
router.patch('/documents/:id', ...browse, handlers.patch);
router.delete('/documents/:id', ...browse, handlers.remove);
router.get('/documents/:id/units/:index', ...browse, handlers.getUnit);
router.put('/documents/:id/units/:index/text', ...browse, handlers.saveUnitText);
router.get('/documents/:id/resources', ...browse, handlers.getResource);
router.get('/documents/:id/source', ...browse, handlers.getSource);
router.delete('/documents/:id/source', ...browse, handlers.removeSource);
router.put('/documents/:id/progress', ...browse, handlers.setProgress);

router.post('/highlights', ...browse, handlers.createHighlight);
router.patch('/highlights/:id', ...browse, handlers.patchHighlight);
router.delete('/highlights/:id', ...browse, handlers.removeHighlight);

module.exports = router;
