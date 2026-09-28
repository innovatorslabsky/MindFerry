import { createHmac } from 'node:crypto';
import {
  verifySlackSignature,
  parseSlackRequest,
  buildFireTriggerRequestBody,
  idempotencyKeyForSlackEvent,
} from './slack';

function sign(secret: string, timestamp: string, rawBody: string): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
}

describe('verifySlackSignature', () => {
  const secret = 'shh-its-a-secret';
  const rawBody = '{"type":"event_callback"}';
  const nowSeconds = 1_700_000_000;
  const timestamp = String(nowSeconds);
  const now = () => nowSeconds * 1000;

  it('accepts a correctly computed signature within the replay window', () => {
    const signature = sign(secret, timestamp, rawBody);
    expect(
      verifySlackSignature({ signingSecret: secret, signature, timestamp, rawBody, now }),
    ).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const signature = sign('wrong-secret', timestamp, rawBody);
    expect(
      verifySlackSignature({ signingSecret: secret, signature, timestamp, rawBody, now }),
    ).toBe(false);
  });

  it('rejects a signature computed over a different body (tampering)', () => {
    const signature = sign(secret, timestamp, rawBody);
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature,
        timestamp,
        rawBody: '{"type":"tampered"}',
        now,
      }),
    ).toBe(false);
  });

  it('rejects a timestamp older than the replay window', () => {
    const oldTimestamp = String(nowSeconds - 10 * 60);
    const signature = sign(secret, oldTimestamp, rawBody);
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature,
        timestamp: oldTimestamp,
        rawBody,
        now,
      }),
    ).toBe(false);
  });

  it('rejects a timestamp from the future beyond the replay window', () => {
    const futureTimestamp = String(nowSeconds + 10 * 60);
    const signature = sign(secret, futureTimestamp, rawBody);
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature,
        timestamp: futureTimestamp,
        rawBody,
        now,
      }),
    ).toBe(false);
  });

  it('rejects a missing signature or timestamp', () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: undefined,
        timestamp,
        rawBody,
        now,
      }),
    ).toBe(false);
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(secret, timestamp, rawBody),
        timestamp: undefined,
        rawBody,
        now,
      }),
    ).toBe(false);
  });

  it('rejects a non-numeric timestamp', () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: 'v0=anything',
        timestamp: 'not-a-number',
        rawBody,
        now,
      }),
    ).toBe(false);
  });
});

describe('parseSlackRequest', () => {
  it('handles the url_verification handshake', () => {
    expect(parseSlackRequest({ type: 'url_verification', challenge: 'abc123' })).toEqual({
      kind: 'url_verification',
      challenge: 'abc123',
    });
  });

  it('parses a genuine user message event', () => {
    expect(
      parseSlackRequest({
        type: 'event_callback',
        event_id: 'Ev123',
        event: { type: 'message', channel: 'C1', user: 'U1', text: 'hello', ts: '1700000000.001' },
      }),
    ).toEqual({
      kind: 'message',
      eventId: 'Ev123',
      channel: 'C1',
      user: 'U1',
      text: 'hello',
      ts: '1700000000.001',
    });
  });

  it('carries thread_ts through as threadTs when present', () => {
    const result = parseSlackRequest({
      type: 'event_callback',
      event_id: 'Ev123',
      event: {
        type: 'message',
        channel: 'C1',
        user: 'U1',
        text: 'hello',
        ts: '1700000000.002',
        thread_ts: '1700000000.001',
      },
    });
    expect(result).toMatchObject({ kind: 'message', threadTs: '1700000000.001' });
  });

  it('ignores the bridge bot own messages, to avoid an echo loop', () => {
    expect(
      parseSlackRequest({
        type: 'event_callback',
        event_id: 'Ev123',
        event: { type: 'message', channel: 'C1', bot_id: 'B1', text: 'a reply', ts: '1' },
      }),
    ).toMatchObject({ kind: 'ignored' });
  });

  it('ignores non-plain-message subtypes (edits, joins, etc.)', () => {
    expect(
      parseSlackRequest({
        type: 'event_callback',
        event_id: 'Ev123',
        event: {
          type: 'message',
          subtype: 'message_changed',
          channel: 'C1',
          user: 'U1',
          text: 'edited',
          ts: '1',
        },
      }),
    ).toMatchObject({ kind: 'ignored' });
  });

  it('ignores a non-message event type', () => {
    expect(
      parseSlackRequest({
        type: 'event_callback',
        event_id: 'Ev123',
        event: { type: 'reaction_added' },
      }),
    ).toMatchObject({ kind: 'ignored' });
  });

  it('ignores an unrecognized top-level envelope', () => {
    expect(parseSlackRequest({ type: 'something_else' })).toMatchObject({ kind: 'ignored' });
    expect(parseSlackRequest(null)).toMatchObject({ kind: 'ignored' });
    expect(parseSlackRequest('not an object')).toMatchObject({ kind: 'ignored' });
  });

  it('ignores a message event missing a required field', () => {
    expect(
      parseSlackRequest({
        type: 'event_callback',
        event_id: 'Ev123',
        event: { type: 'message', channel: 'C1' /* no user/text/ts */ },
      }),
    ).toMatchObject({ kind: 'ignored' });
  });
});

describe('buildFireTriggerRequestBody', () => {
  const slackEvent = {
    kind: 'message' as const,
    eventId: 'Ev123',
    channel: 'C1',
    user: 'U1',
    text: 'What is on the roadmap?',
    ts: '1700000000.500',
  };

  it('maps a Slack message into a fire-mode trigger request body', () => {
    expect(buildFireTriggerRequestBody('agent-1', slackEvent)).toEqual({
      mode: 'fire',
      event: {
        id: 'Ev123',
        type: 'slack.message',
        occurredAt: 1_700_000_000_500,
        source: { id: 'C1', type: 'slack' },
        payload: { channel: 'C1', user: 'U1', ts: '1700000000.500' },
      },
      target: { agentId: 'agent-1' },
      input: 'What is on the roadmap?',
    });
  });

  it('carries threadTs into the payload when the message was in a thread', () => {
    const body = buildFireTriggerRequestBody('agent-1', {
      ...slackEvent,
      threadTs: '1700000000.1',
    });
    expect(body.event.payload.threadTs).toBe('1700000000.1');
  });
});

describe('idempotencyKeyForSlackEvent', () => {
  it("derives a stable key from Slack's own event id", () => {
    expect(
      idempotencyKeyForSlackEvent({
        kind: 'message',
        eventId: 'Ev123',
        channel: 'C1',
        user: 'U1',
        text: 'x',
        ts: '1',
      }),
    ).toBe('slack-Ev123');
  });
});
