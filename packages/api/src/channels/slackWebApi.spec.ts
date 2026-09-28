import { createSlackWebApiClient, extractLastAssistantText } from './slackWebApi';

describe('createSlackWebApiClient', () => {
  function fakeFetch(body: unknown, ok = true, status = 200) {
    return jest.fn().mockResolvedValue({
      ok,
      status,
      json: jest.fn().mockResolvedValue(body),
    }) as unknown as typeof fetch;
  }

  it('posts to chat.postMessage with the bot token and channel/text', async () => {
    const fetchFn = fakeFetch({ ok: true });
    const client = createSlackWebApiClient('xoxb-test', fetchFn);

    await client.postToSlack({ channel: 'C1', text: 'hello' });

    expect(fetchFn).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer xoxb-test' }),
      }),
    );
    const [, init] = (fetchFn as unknown as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ channel: 'C1', text: 'hello' });
  });

  it('includes thread_ts when replying in a thread', async () => {
    const fetchFn = fakeFetch({ ok: true });
    const client = createSlackWebApiClient('xoxb-test', fetchFn);

    await client.postToSlack({ channel: 'C1', text: 'hello', threadTs: '123.45' });

    const [, init] = (fetchFn as unknown as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body as string)).toMatchObject({ thread_ts: '123.45' });
  });

  it("throws when Slack's API reports ok: false", async () => {
    const fetchFn = fakeFetch({ ok: false, error: 'channel_not_found' });
    const client = createSlackWebApiClient('xoxb-test', fetchFn);

    await expect(client.postToSlack({ channel: 'C1', text: 'hi' })).rejects.toThrow(
      /channel_not_found/,
    );
  });

  it('throws on a non-200 HTTP status', async () => {
    const fetchFn = fakeFetch({ ok: false }, false, 500);
    const client = createSlackWebApiClient('xoxb-test', fetchFn);

    await expect(client.postToSlack({ channel: 'C1', text: 'hi' })).rejects.toThrow();
  });
});

describe('extractLastAssistantText', () => {
  it('returns undefined when there are no assistant messages', () => {
    expect(extractLastAssistantText([{ isCreatedByUser: true, text: 'hi' }])).toBeUndefined();
  });

  it('returns undefined for an empty list', () => {
    expect(extractLastAssistantText([])).toBeUndefined();
  });

  it('picks the most recent non-user message by createdAt', () => {
    const messages = [
      { isCreatedByUser: false, text: 'first reply', createdAt: '2024-01-01T00:00:00Z' },
      { isCreatedByUser: true, text: 'a follow-up question', createdAt: '2024-01-01T00:01:00Z' },
      { isCreatedByUser: false, text: 'second reply', createdAt: '2024-01-01T00:02:00Z' },
    ];

    expect(extractLastAssistantText(messages)).toBe('second reply');
  });

  it('returns undefined when the most recent assistant message has empty text', () => {
    expect(
      extractLastAssistantText([{ isCreatedByUser: false, text: '  ', createdAt: '2024-01-01' }]),
    ).toBeUndefined();
  });
});
