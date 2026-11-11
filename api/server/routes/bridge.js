const express = require('express');
const {
  createBridgeHandlers,
  createRolesHandlers,
  GenerationJobManager,
} = require('@librechat/api');
const { configMiddleware, requireJwtAuth } = require('~/server/middleware');
const { resolveAgentFireAccess } = require('~/server/services/Schedules/access');
const { enqueueAgentTrigger } = require('~/server/services/Agents/triggers');
const checkAdmin = require('~/server/middleware/roles/admin');
const methods = require('~/models');

const router = express.Router();

/**
 * The agent bridge: an admin-only page over the task folder MindFerry shares with the agents on
 * the host. Every route needs a signed-in admin and answers 404 unless `agentBridge.enabled`.
 */
const handlers = createBridgeHandlers();

/** Roles run as in-app agents: the same access check and durable queue the schedules use. */
const roles = createRolesHandlers({
  methods,
  enqueueTrigger: enqueueAgentTrigger,
  getJobStatus: async (conversationId) =>
    (await GenerationJobManager.getJobStore()?.getJob(conversationId))?.status,
  resolveAgent: async (actor, agentId) => {
    if ((await resolveAgentFireAccess(agentId, actor)) !== 'ok') {
      return null;
    }
    const agent = await methods.getAgent({ id: agentId });
    return agent ? { id: agentId, provider: agent.provider, model: agent.model } : null;
  },
});

router.use(requireJwtAuth, configMiddleware, checkAdmin);

router.get('/overview', handlers.overview);
router.get('/tasks/:id/result', handlers.getResult);
router.post('/tasks', handlers.createTask);

router.get('/roles', roles.overview);
router.post('/roles', roles.create);
router.patch('/roles/:id', roles.update);
router.delete('/roles/:id', roles.remove);
router.post('/roles/:id/assign', roles.assign);

module.exports = router;
