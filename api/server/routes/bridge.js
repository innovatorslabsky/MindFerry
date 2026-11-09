const express = require('express');
const { createBridgeHandlers } = require('@librechat/api');
const { configMiddleware, requireJwtAuth } = require('~/server/middleware');
const checkAdmin = require('~/server/middleware/roles/admin');

const router = express.Router();

/**
 * The agent bridge: an admin-only page over the task folder MindFerry shares with the agents on
 * the host. Every route needs a signed-in admin and answers 404 unless `agentBridge.enabled`.
 */
const handlers = createBridgeHandlers();

router.use(requireJwtAuth, configMiddleware, checkAdmin);

router.get('/overview', handlers.overview);
router.get('/tasks/:id/result', handlers.getResult);
router.post('/tasks', handlers.createTask);

module.exports = router;
