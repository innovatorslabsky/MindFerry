const express = require('express');
const { logger, CLIENT_MESSAGE_SELECT } = require('@librechat/data-schemas');
const { extractEnvVariable } = require('librechat-data-provider');
const {
  createSlackEventsHandler,
  createSlackWebApiClient,
  extractLastAssistantText,
} = require('@librechat/api');
const { configMiddleware } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

/**
 * Bridges Slack messages to one LibreChat agent over the existing Remote
 * Agent trigger API. Unauthenticated by LibreChat's own session/API-key
 * schemes — Slack's own request signature (verified inside
 * `createSlackEventsHandler`) is this endpoint's only credential, the same
 * way any Slack Events API receiver works. See docs/slack-bridge.md.
 *
 * All decision logic (signature check, event parsing, the fire → poll →
 * reply relay) lives in `@librechat/api`; this file only resolves this
 * request's config, builds this call's dependencies, and dispatches —
 * per this repo's rule that `/api` holds wiring, not behavior.
 */
router.post('/events', configMiddleware, async (req, res) => {
  const slackConfig = req.config?.channels?.slack;
  if (!slackConfig?.enabled) {
    res.status(404).json({ error: { message: 'Slack bridge is not enabled' } });
    return;
  }

  const { postToSlack } = createSlackWebApiClient(extractEnvVariable(slackConfig.botToken));

  const handler = createSlackEventsHandler({
    signingSecret: extractEnvVariable(slackConfig.signingSecret),
    agentId: slackConfig.agentId,
    triggerApiKey: extractEnvVariable(slackConfig.apiKey),
    // DOMAIN_SERVER is this deployment's public origin, already required for
    // the context hub's OAuth server (see docs/mindferry.md) — reused here
    // rather than trusting a client-supplied Host header for the same reason
    // that page gives: it becomes part of an outbound request LibreChat
    // itself makes, not just a display string.
    baseUrl: process.env.DOMAIN_SERVER || `${req.protocol}://${req.get('host')}`,
    postToSlack,
    getReplyText: async (conversationId) => {
      try {
        const messages = await db.getMessages({ conversationId }, CLIENT_MESSAGE_SELECT);
        return extractLastAssistantText(messages ?? []);
      } catch (error) {
        logger.error('[slackBridge] Failed to read back the agent reply:', error);
        return undefined;
      }
    },
  });

  await handler(req, res);
});

module.exports = router;
