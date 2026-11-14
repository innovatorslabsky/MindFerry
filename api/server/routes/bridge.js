const express = require('express');
const {
  createBridgeHandlers,
  createRolesHandlers,
  createApprovalsHandlers,
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
const rolesDeps = {
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
};
const roles = createRolesHandlers(rolesDeps);
/** Approvals hand work over through the roles service, so they share its dependencies. */
const approvals = createApprovalsHandlers(rolesDeps);

router.use(requireJwtAuth, configMiddleware, checkAdmin);

router.get('/overview', handlers.overview);
router.get('/tasks/:id/result', handlers.getResult);
router.post('/tasks', handlers.createTask);

router.get('/roles', roles.overview);
router.post('/roles', roles.create);
router.patch('/roles/:id', roles.update);
router.delete('/roles/:id', roles.remove);
router.post('/roles/:id/assign', roles.assign);

router.get('/approvals', approvals.overview);
router.post('/approvals', approvals.create);
router.post('/approvals/:id/decide', approvals.decide);
router.get('/audit', approvals.audit);

module.exports = router;
