import { logger } from '@librechat/data-schemas';
import type { SlackMessageEvent } from './slack';
import {
  parseSlackRequest,
  verifySlackSignature,
  buildFireTriggerRequestBody,
  idempotencyKeyForSlackEvent,
} from './slack';

/**
 * Wires the pure Slack logic in `slack.ts` to the trigger API this app
 * already exposes at `POST /api/agents/v1/events` (see
 * `packages/api/src/agents/triggers/README.md`) — calling it exactly the way
 * any external integration would, over HTTP with a Remote Agents API key,
 * rather than reaching into that service's internal singleton. Everything
 * that actually talks to the network or a database is an injected
 * dependency, so this module can be tested without a live Slack workspace,
 * a live LibreChat server, or a live trigger delivery.
 */

interface SlackDeliveryStatus {
  id: string;
  status: 'pending' | 'leased' | 'succeeded' | 'dead';
  result?: { conversationId?: string };
  error?: { message?: string };
}

export interface CreateSlackEventsHandlerOptions {
  /** Slack app's "Signing Secret," from its Basic Information page. */
  signingSecret: string;
  /** Which LibreChat agent handles every Slack message — see docs/slack-bridge.md
   *  for why v1 is one bridge, one agent, rather than per-channel routing. */
  agentId: string;
  /** A Remote Agents API key (Settings → API Keys → Agent API Keys) for the
   *  LibreChat user this bridge acts as. That user needs VIEW access to
   *  `agentId` — the trigger API's own ACL check enforces this, so a
   *  misconfigured bridge fails closed with a 403 from the call below,
   *  never a silent no-op. */
  triggerApiKey: string;
  /** This deployment's own origin, e.g. `https://mindferry.example.com`. */
  baseUrl: string;
  /** Sends the agent's reply back to Slack (typically `chat.postMessage`
   *  with a bot token) — this module never calls Slack's Web API directly. */
  postToSlack: (input: { channel: string; text: string; threadTs?: string }) => Promise<void>;
  /** Reads back the assistant's reply for a succeeded delivery's
   *  `result.conversationId` — the trigger API's own status endpoint
   *  deliberately never exposes message content (see the README), so the
   *  caller supplies how to read it from wherever LibreChat stores messages. */
  getReplyText: (conversationId: string) => Promise<string | undefined>;
  fetchFn?: typeof fetch;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

interface SlackRequestLike {
  headers: Record<string, string | string[] | undefined>;
  /** The exact bytes Slack signed, captured before JSON parsing. */
  rawBody: string;
  body: unknown;
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_POLL_TIMEOUT_MS = 60_000;

function header(req: SlackRequestLike, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function pollDeliveryUntilSettled(
  deliveryUrl: string,
  triggerApiKey: string,
  fetchFn: typeof fetch,
  pollIntervalMs: number,
  pollTimeoutMs: number,
): Promise<SlackDeliveryStatus | undefined> {
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    const response = await fetchFn(deliveryUrl, {
      headers: { Authorization: `Bearer ${triggerApiKey}` },
    });
    if (!response.ok) {
      return undefined;
    }
    const delivery = (await response.json()) as SlackDeliveryStatus;
    if (delivery.status === 'succeeded' || delivery.status === 'dead') {
      return delivery;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return undefined;
}

/** Exported so tests can exercise the fire → poll → reply relay directly,
 *  without waiting on the fire-and-forget call `createSlackEventsHandler`
 *  makes after it has already responded to Slack. */
export async function relayToSlack(
  slackEvent: SlackMessageEvent,
  options: CreateSlackEventsHandlerOptions,
): Promise<void> {
  const {
    agentId,
    triggerApiKey,
    baseUrl,
    postToSlack,
    getReplyText,
    fetchFn = fetch,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  } = options;

  try {
    const enqueueResponse = await fetchFn(`${baseUrl}/api/agents/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${triggerApiKey}`,
        'Idempotency-Key': idempotencyKeyForSlackEvent(slackEvent),
      },
      body: JSON.stringify(buildFireTriggerRequestBody(agentId, slackEvent)),
    });

    if (!enqueueResponse.ok) {
      logger.error(
        `[slackBridge] Trigger API rejected the fire event: ${enqueueResponse.status}`,
        await enqueueResponse.text().catch(() => ''),
      );
      return;
    }

    const location = enqueueResponse.headers.get('Location');
    const deliveryUrl = location ? new URL(location, baseUrl).toString() : undefined;
    if (!deliveryUrl) {
      logger.error('[slackBridge] Trigger API accepted the event but returned no Location header');
      return;
    }

    const delivery = await pollDeliveryUntilSettled(
      deliveryUrl,
      triggerApiKey,
      fetchFn,
      pollIntervalMs,
      pollTimeoutMs,
    );
    if (!delivery) {
      logger.warn(
        `[slackBridge] Delivery for Slack event ${slackEvent.eventId} did not settle in time`,
      );
      return;
    }
    if (delivery.status === 'dead' || !delivery.result?.conversationId) {
      logger.error(
        `[slackBridge] Delivery for Slack event ${slackEvent.eventId} failed:`,
        delivery.error,
      );
      return;
    }

    const replyText = await getReplyText(delivery.result.conversationId);
    if (!replyText) {
      logger.warn(
        `[slackBridge] No reply text found for conversation ${delivery.result.conversationId}`,
      );
      return;
    }

    await postToSlack({
      channel: slackEvent.channel,
      text: replyText,
      ...(slackEvent.threadTs != null && { threadTs: slackEvent.threadTs }),
    });
  } catch (error) {
    logger.error('[slackBridge] Unhandled error relaying a Slack message:', error);
  }
}

/**
 * Builds the Express-shaped handler for Slack's Events API webhook.
 * Verifies Slack's signature, acks immediately (Slack requires a fast 200
 * regardless of outcome), and — for a genuine user message only — continues
 * the fire → poll → reply relay in the background after responding, since
 * that round trip runs far longer than Slack's ack window.
 */
export function createSlackEventsHandler(
  options: CreateSlackEventsHandlerOptions,
  /** Substituted by tests to observe/await the relay without the real
   *  network+polling round trip; defaults to the real `relayToSlack`. */
  relay: typeof relayToSlack = relayToSlack,
) {
  return async (req: SlackRequestLike, res: ResponseLike): Promise<void> => {
    const verified = verifySlackSignature({
      signingSecret: options.signingSecret,
      signature: header(req, 'x-slack-signature'),
      timestamp: header(req, 'x-slack-request-timestamp'),
      rawBody: req.rawBody,
    });
    if (!verified) {
      res.status(401).json({ error: 'invalid signature' });
      return;
    }

    const parsed = parseSlackRequest(req.body);

    if (parsed.kind === 'url_verification') {
      res.status(200).json({ challenge: parsed.challenge });
      return;
    }

    if (parsed.kind === 'ignored') {
      res.status(200).json({ ok: true });
      return;
    }

    res.status(200).json({ ok: true });
    void relay(parsed, options);
  };
}
