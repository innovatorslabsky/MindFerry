import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Pure Slack Events API logic: signature verification, request parsing, and
 * mapping a Slack message into the wire body `POST /api/agents/v1/events`
 * expects (see `packages/api/src/agents/triggers/README.md`). No network
 * calls, no app state — `slackBridge.ts` supplies those as injected
 * dependencies, per this repo's rule that integrations are injected rather
 * than reached for.
 */

const SLACK_SIGNATURE_VERSION = 'v0';
/** Slack's own replay-protection window recommendation. */
const SLACK_SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

export interface VerifySlackSignatureInput {
  signingSecret: string;
  /** The raw `X-Slack-Signature` header value, e.g. `v0=abcdef...`. */
  signature: string | undefined;
  /** The raw `X-Slack-Request-Timestamp` header value (unix seconds, as a string). */
  timestamp: string | undefined;
  /** The exact request body bytes Slack signed — must be captured before
   *  any JSON parsing/re-serialization, which would not byte-for-byte match. */
  rawBody: string;
  now?: () => number;
}

/**
 * Slack's v0 signing scheme: `v0=HMAC-SHA256(signingSecret, "v0:{timestamp}:{rawBody}")`,
 * compared in constant time, with the timestamp checked against replay.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(input: VerifySlackSignatureInput): boolean {
  const { signingSecret, signature, timestamp, rawBody, now = () => Date.now() } = input;
  if (!signature || !timestamp) {
    return false;
  }
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }
  if (Math.abs(now() / 1000 - timestampSeconds) > SLACK_SIGNATURE_MAX_AGE_SECONDS) {
    return false;
  }

  const baseString = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${rawBody}`;
  const expected = `${SLACK_SIGNATURE_VERSION}=${createHmac('sha256', signingSecret)
    .update(baseString)
    .digest('hex')}`;

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export interface SlackUrlVerification {
  kind: 'url_verification';
  challenge: string;
}

export interface SlackMessageEvent {
  kind: 'message';
  eventId: string;
  channel: string;
  user: string;
  text: string;
  ts: string;
  threadTs?: string;
}

export interface SlackIgnoredEvent {
  kind: 'ignored';
  /** Why this was ignored — logged by the caller, never sent to Slack. */
  reason: string;
}

export type SlackParsedRequest = SlackUrlVerification | SlackMessageEvent | SlackIgnoredEvent;

/** Loosely typed on purpose — this is untrusted input from the network,
 *  narrowed field by field below rather than trusted via a single cast to
 *  one of Slack's documented envelope shapes. */
interface SlackRequestBody {
  type?: string;
  challenge?: string;
  event_id?: string;
  event?: {
    type?: string;
    subtype?: string;
    channel?: string;
    user?: string;
    bot_id?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
  };
}

/**
 * Slack's Events API envelope: either the one-time `url_verification`
 * handshake, or an `event_callback` wrapping one event. Anything else —
 * a bot's own message (`bot_id` set, which would otherwise loop the bridge
 * back on its own replies), a subtype like `message_changed`, or a
 * non-`message` event type — is `ignored` rather than rejected: Slack still
 * needs its fast 200 ack for those, just with no further action taken.
 */
export function parseSlackRequest(body: unknown): SlackParsedRequest {
  if (body == null || typeof body !== 'object') {
    return { kind: 'ignored', reason: 'request body is not an object' };
  }
  const record = body as SlackRequestBody;

  if (record.type === 'url_verification') {
    if (typeof record.challenge !== 'string') {
      return { kind: 'ignored', reason: 'url_verification missing challenge' };
    }
    return { kind: 'url_verification', challenge: record.challenge };
  }

  if (record.type !== 'event_callback') {
    return { kind: 'ignored', reason: `unsupported envelope type: ${String(record.type)}` };
  }
  const event = record.event;
  if (!event || event.type !== 'message') {
    return { kind: 'ignored', reason: `unsupported event type: ${String(event?.type)}` };
  }
  if (event.bot_id) {
    return { kind: 'ignored', reason: 'message was posted by a bot (avoids echo loops)' };
  }
  if (event.subtype) {
    return { kind: 'ignored', reason: `unsupported message subtype: ${event.subtype}` };
  }
  if (!event.channel || !event.user || !event.text || !event.ts || !record.event_id) {
    return { kind: 'ignored', reason: 'message event missing a required field' };
  }

  return {
    kind: 'message',
    eventId: record.event_id,
    channel: event.channel,
    user: event.user,
    text: event.text,
    ts: event.ts,
    ...(event.thread_ts != null && { threadTs: event.thread_ts }),
  };
}

export interface FireTriggerRequestBody {
  mode: 'fire';
  event: {
    id: string;
    type: 'slack.message';
    occurredAt: number;
    source: { id: string; type: 'slack' };
    payload: { channel: string; user: string; ts: string; threadTs?: string };
  };
  target: { agentId: string };
  input: string;
}

/**
 * Maps one Slack message into the exact `POST /api/agents/v1/events` fire-mode
 * body (see the gold example in `agents/triggers/ingress.spec.ts`). Always
 * `fire`, never `continue`: registering a continuation binding needs a parent
 * LibreChat agent conversation the caller's user already owns, which a bare
 * Slack channel has none of — see docs/slack-bridge.md for why this is v1's
 * deliberate scope, and what continuity would need on top of it.
 */
export function buildFireTriggerRequestBody(
  agentId: string,
  slackEvent: SlackMessageEvent,
): FireTriggerRequestBody {
  return {
    mode: 'fire',
    event: {
      id: slackEvent.eventId,
      type: 'slack.message',
      occurredAt: Math.round(Number(slackEvent.ts) * 1000),
      source: { id: slackEvent.channel, type: 'slack' },
      payload: {
        channel: slackEvent.channel,
        user: slackEvent.user,
        ts: slackEvent.ts,
        ...(slackEvent.threadTs != null && { threadTs: slackEvent.threadTs }),
      },
    },
    target: { agentId },
    input: slackEvent.text,
  };
}

/**
 * Slack retries an undelivered webhook with the same `event_id` — using it
 * as the trigger API's `Idempotency-Key` means a Slack-side retry can never
 * fire the agent twice for the same message.
 */
export function idempotencyKeyForSlackEvent(slackEvent: SlackMessageEvent): string {
  return `slack-${slackEvent.eventId}`;
}
