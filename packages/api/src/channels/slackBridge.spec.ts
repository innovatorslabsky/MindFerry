import { createHmac } from 'node:crypto';
import type { CreateSlackEventsHandlerOptions } from './slackBridge';
import type { SlackMessageEvent } from './slack';
import { createSlackEventsHandler, relayToSlack } from './slackBridge';

function sign(secret: string, timestamp: string, rawBody: string): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
}

function fakeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

const secret = 'shh-its-a-secret';

function signedRequest(rawBody: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  return {
    headers: {
      'x-slack-signature': sign(secret, timestamp, rawBody),
      'x-slack-request-timestamp': timestamp,
    },
    rawBody,
    body: JSON.parse(rawBody),
  };
}

const baseOptions: CreateSlackEventsHandlerOptions = {
  signingSecret: secret,
  agentId: 'agent-1',
  triggerApiKey: 'trigger-key',
  baseUrl: 'https://mindferry.example.com',
  postToSlack: jest.fn().mockResolvedValue(undefined),
  getReplyText: jest.fn().mockResolvedValue('the reply'),
};

describe('createSlackEventsHandler', () => {
  it('rejects a request with an invalid signature before parsing anything', async () => {
    const handler = createSlackEventsHandler(baseOptions);
    const req = {
      headers: { 'x-slack-signature': 'v0=wrong', 'x-slack-request-timestamp': '1' },
      rawBody: '{}',
      body: {},
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('answers the url_verification handshake with the challenge', async () => {
    const handler = createSlackEventsHandler(baseOptions);
    const rawBody = JSON.stringify({ type: 'url_verification', challenge: 'abc123' });
    const res = fakeRes();

    await handler(signedRequest(rawBody), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ challenge: 'abc123' });
  });

  it('acks an ignored event (e.g. the bridge bot own message) without relaying', async () => {
    const relay = jest.fn();
    const handler = createSlackEventsHandler(baseOptions, relay);
    const rawBody = JSON.stringify({
      type: 'event_callback',
      event_id: 'Ev1',
      event: { type: 'message', channel: 'C1', bot_id: 'B1', text: 'x', ts: '1' },
    });
    const res = fakeRes();

    await handler(signedRequest(rawBody), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(relay).not.toHaveBeenCalled();
  });

  it('acks a genuine message immediately, then relays in the background', async () => {
    let relayResolve: () => void = () => {};
    const relay = jest.fn(() => new Promise<void>((resolve) => (relayResolve = resolve)));
    const handler = createSlackEventsHandler(baseOptions, relay);
    const rawBody = JSON.stringify({
      type: 'event_callback',
      event_id: 'Ev1',
      event: { type: 'message', channel: 'C1', user: 'U1', text: 'hi', ts: '1' },
    });
    const res = fakeRes();

    await handler(signedRequest(rawBody), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(relay).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'message', channel: 'C1' }),
      baseOptions,
    );
    relayResolve();
  });
});

describe('relayToSlack', () => {
  const slackEvent: SlackMessageEvent = {
    kind: 'message',
    eventId: 'Ev1',
    channel: 'C1',
    user: 'U1',
    text: 'hi',
    ts: '1',
  };

  function fakeFetch(
    responses: Array<{ status: number; headers?: Record<string, string>; body: unknown }>,
  ) {
    let call = 0;
    const mock = jest.fn(async () => {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        headers: { get: (name: string) => response.headers?.[name.toLowerCase()] ?? null },
        json: async () => response.body,
        text: async () => JSON.stringify(response.body),
      } as unknown as Response;
    });
    return mock as unknown as typeof fetch;
  }

  it('fires the event, polls until success, then posts the reply back to Slack', async () => {
    const postToSlack = jest.fn().mockResolvedValue(undefined);
    const getReplyText = jest.fn().mockResolvedValue('here is the answer');
    const fetchFn = fakeFetch([
      { status: 202, headers: { location: '/api/agents/v1/events/trigger_abc' }, body: {} },
      {
        status: 200,
        body: { id: 'trigger_abc', status: 'succeeded', result: { conversationId: 'conv-1' } },
      },
    ]);

    await relayToSlack(slackEvent, {
      ...baseOptions,
      postToSlack,
      getReplyText,
      fetchFn,
      pollIntervalMs: 1,
      pollTimeoutMs: 1000,
    });

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      'https://mindferry.example.com/api/agents/v1/events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer trigger-key',
          'Idempotency-Key': 'slack-Ev1',
        }),
      }),
    );
    expect(getReplyText).toHaveBeenCalledWith('conv-1');
    expect(postToSlack).toHaveBeenCalledWith({ channel: 'C1', text: 'here is the answer' });
  });

  it('includes threadTs when replying to a threaded message', async () => {
    const postToSlack = jest.fn().mockResolvedValue(undefined);
    const fetchFn = fakeFetch([
      { status: 202, headers: { location: '/api/agents/v1/events/trigger_abc' }, body: {} },
      {
        status: 200,
        body: { id: 'trigger_abc', status: 'succeeded', result: { conversationId: 'conv-1' } },
      },
    ]);

    await relayToSlack(
      { ...slackEvent, threadTs: '0.5' },
      { ...baseOptions, postToSlack, fetchFn, pollIntervalMs: 1, pollTimeoutMs: 1000 },
    );

    expect(postToSlack).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C1', threadTs: '0.5' }),
    );
  });

  it('does not reply to Slack when the delivery ends up dead', async () => {
    const postToSlack = jest.fn();
    const fetchFn = fakeFetch([
      { status: 202, headers: { location: '/api/agents/v1/events/trigger_abc' }, body: {} },
      { status: 200, body: { id: 'trigger_abc', status: 'dead', error: { message: 'boom' } } },
    ]);

    await relayToSlack(slackEvent, {
      ...baseOptions,
      postToSlack,
      fetchFn,
      pollIntervalMs: 1,
      pollTimeoutMs: 1000,
    });

    expect(postToSlack).not.toHaveBeenCalled();
  });

  it('does not reply when the enqueue call itself is rejected', async () => {
    const postToSlack = jest.fn();
    const fetchFn = fakeFetch([{ status: 403, body: { error: 'access_denied' } }]);

    await relayToSlack(slackEvent, { ...baseOptions, postToSlack, fetchFn });

    expect(postToSlack).not.toHaveBeenCalled();
  });

  it('gives up and does not reply when the delivery never settles before the timeout', async () => {
    const postToSlack = jest.fn();
    const fetchFn = fakeFetch([
      { status: 202, headers: { location: '/api/agents/v1/events/trigger_abc' }, body: {} },
      { status: 200, body: { id: 'trigger_abc', status: 'pending' } },
    ]);

    await relayToSlack(slackEvent, {
      ...baseOptions,
      postToSlack,
      fetchFn,
      pollIntervalMs: 1,
      pollTimeoutMs: 5,
    });

    expect(postToSlack).not.toHaveBeenCalled();
  });

  it('never throws out of the relay, even when a dependency rejects', async () => {
    const fetchFn = jest
      .fn()
      .mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    await expect(relayToSlack(slackEvent, { ...baseOptions, fetchFn })).resolves.toBeUndefined();
  });
});
