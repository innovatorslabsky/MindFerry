import type { AppConfig, HubThreadRecord } from '@librechat/data-schemas';
import { createArchiveHubSync, saveConversationToHub } from './sync';

const enabled = { contextHub: { enabled: true } } as unknown as AppConfig;

const conversation = {
  conversationId: 'c1',
  title: 'Planning the archive',
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T01:00:00Z',
};

const messages = [
  {
    messageId: 'm1',
    parentMessageId: null,
    text: 'Archive should also save to the hub',
    isCreatedByUser: true,
    createdAt: '2026-09-30T00:00:00Z',
  },
  {
    messageId: 'm2',
    parentMessageId: 'm1',
    text: 'Agreed.',
    isCreatedByUser: false,
    createdAt: '2026-09-30T00:00:05Z',
  },
];

function deps() {
  const saved: Array<{ userId: string; thread: HubThreadRecord }> = [];
  return {
    saved,
    getConvo: jest.fn().mockResolvedValue(conversation),
    getMessages: jest.fn().mockResolvedValue(messages),
    methods: {
      upsertHubThread: jest.fn(async (userId: string, thread: HubThreadRecord) => {
        saved.push({ userId, thread });
      }),
    },
  };
}

describe('saveConversationToHub', () => {
  it("saves the caller's conversation as a MindFerry chat thread keyed by its id", async () => {
    const d = deps();

    const result = await saveConversationToHub(d, 'user-a', 'c1', enabled);

    expect(d.getConvo).toHaveBeenCalledWith('user-a', 'c1');
    expect(d.getMessages).toHaveBeenCalledWith({ conversationId: 'c1', user: 'user-a' });
    expect(result).toEqual({ threadId: 'mindferry:c1', messageCount: 2 });
    expect(d.saved).toHaveLength(1);
    expect(d.saved[0].userId).toBe('user-a');
    expect(d.saved[0].thread).toMatchObject({
      id: 'mindferry:c1',
      provider: 'mindferry',
      surface: 'chat',
      title: 'Planning the archive',
    });
  });

  it('returns null without saving when the caller has no such conversation', async () => {
    const d = deps();
    d.getConvo.mockResolvedValue(null);

    expect(await saveConversationToHub(d, 'user-a', 'c1', enabled)).toBeNull();
    expect(d.getMessages).not.toHaveBeenCalled();
    expect(d.methods.upsertHubThread).not.toHaveBeenCalled();
  });
});

describe('createArchiveHubSync', () => {
  it('saves the archived chat to the hub', async () => {
    const d = deps();
    const sync = createArchiveHubSync(d);

    const outcome = await sync({ userId: 'user-a', conversationId: 'c1', config: enabled });

    expect(outcome).toBe('saved');
    expect(d.saved[0].thread.id).toBe('mindferry:c1');
  });

  it('does nothing when the hub is off', async () => {
    const d = deps();
    const sync = createArchiveHubSync(d);

    expect(await sync({ userId: 'user-a', conversationId: 'c1', config: undefined })).toBe(
      'disabled',
    );
    expect(d.getConvo).not.toHaveBeenCalled();
  });

  it('reports a failure instead of throwing, so the archive itself stands', async () => {
    const d = deps();
    d.methods.upsertHubThread.mockRejectedValue(new Error('mongo down'));
    const sync = createArchiveHubSync(d);

    await expect(sync({ userId: 'user-a', conversationId: 'c1', config: enabled })).resolves.toBe(
      'failed',
    );
  });

  it('reports a failure when the conversation cannot be read back', async () => {
    const d = deps();
    d.getConvo.mockResolvedValue(undefined);
    const sync = createArchiveHubSync(d);

    expect(await sync({ userId: 'user-a', conversationId: 'c1', config: enabled })).toBe('failed');
  });
});
