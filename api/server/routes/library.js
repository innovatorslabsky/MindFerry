const express = require('express');
const {
  createLibraryService,
  createLibraryHandlers,
  libraryBrowseLimiter,
  librarySaveLimiter,
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
const handlers = createLibraryHandlers({ service: createLibraryService({ methods: db }) });

const browse = [requireJwtAuth, configMiddleware, libraryBrowseLimiter];
const save = [requireJwtAuth, configMiddleware, librarySaveLimiter];

router.post('/documents', ...save, handlers.save);
router.get('/documents', ...browse, handlers.list);
router.get('/documents/:id', ...browse, handlers.get);
router.patch('/documents/:id', ...browse, handlers.patch);
router.delete('/documents/:id', ...browse, handlers.remove);
router.put('/documents/:id/progress', ...browse, handlers.setProgress);

router.post('/highlights', ...browse, handlers.createHighlight);
router.patch('/highlights/:id', ...browse, handlers.patchHighlight);
router.delete('/highlights/:id', ...browse, handlers.removeHighlight);

module.exports = router;
