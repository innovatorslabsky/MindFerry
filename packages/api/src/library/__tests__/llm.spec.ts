import type { ServerRequest } from '../../types/http';
import { createLibraryTextGenerator, LibraryModelError } from '../llm';

const mockInvoke = jest.fn();
const mockGetOptions = jest.fn();

jest.mock('@librechat/agents', () => ({
  Providers: { OPENAI: 'openai', AZURE: 'azure', GOOGLE: 'google', VERTEXAI: 'vertexai' },
  initializeModel: () => ({ invoke: mockInvoke }),
}));
jest.mock('~/endpoints/config/providers', () => ({
  getProviderConfig: ({ provider }: { provider: string }) => {
    if (provider === 'nowhere') {
      throw new Error('unknown');
    }
    return { getOptions: mockGetOptions };
  },
}));
jest.mock('~/middleware/tenant', () => ({ resolveRequestTenantId: () => undefined }));
jest.mock('~/utils/headers', () => ({ resolveConfigHeaders: jest.fn() }));

const spendTokens = jest.fn(async () => undefined);
const findBalanceByUser = jest.fn(async () => ({ tokenCredits: 100 }));
const db = {
  getUserKey: jest.fn(),
  getUserKeyValues: jest.fn(),
  spendTokens,
  findBalanceByUser,
};

const req = (balanceEnabled = false) =>
  ({
    user: { id: 'u1' },
    config: { balance: { enabled: balanceEnabled } },
  }) as unknown as ServerRequest;

const request = { endpoint: 'openAI', model: 'gpt-4o-mini', prompt: 'Summarize' };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOptions.mockResolvedValue({ llmConfig: { model: 'gpt-4o-mini', maxTokens: 64000 } });
  mockInvoke.mockResolvedValue({
    content: [{ type: 'text', text: 'A summary.' }],
    usage_metadata: { input_tokens: 120, output_tokens: 30 },
  });
});

describe('library text generator', () => {
  it('runs the picked model with the person’s credentials and records what it cost', async () => {
    const generate = createLibraryTextGenerator({ db });
    await expect(generate(req(), request)).resolves.toBe('A summary.');

    expect(mockGetOptions).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'openAI', model_parameters: { model: 'gpt-4o-mini' } }),
    );
    expect(mockGetOptions.mock.calls[0][0].db).toBe(db);
    expect(spendTokens).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'u1', model: 'gpt-4o-mini', context: 'library-summary' }),
      { promptTokens: 120, completionTokens: 30 },
    );
  });

  it('turns away a person with no credits left, before any model is called', async () => {
    findBalanceByUser.mockResolvedValueOnce({ tokenCredits: 0 });
    const generate = createLibraryTextGenerator({ db });
    await expect(generate(req(true), request)).rejects.toMatchObject({
      code: 'insufficient_balance',
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('neither checks nor spends credits when the deployment pays', async () => {
    findBalanceByUser.mockResolvedValue({ tokenCredits: 0 });
    const generate = createLibraryTextGenerator({ db });
    await expect(generate(req(true), { ...request, chargeUser: false })).resolves.toBe(
      'A summary.',
    );
    expect(findBalanceByUser).not.toHaveBeenCalled();
    expect(spendTokens).not.toHaveBeenCalled();
  });

  it('does not check credits when balances are off', async () => {
    const generate = createLibraryTextGenerator({ db });
    await generate(req(false), request);
    expect(findBalanceByUser).not.toHaveBeenCalled();
  });

  it('refuses agent, assistant and unknown endpoints', async () => {
    const generate = createLibraryTextGenerator({ db });
    for (const endpoint of ['agents', 'assistants', 'nowhere']) {
      await expect(generate(req(), { ...request, endpoint })).rejects.toBeInstanceOf(
        LibraryModelError,
      );
    }
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('fails on an empty answer and still bills the call', async () => {
    mockInvoke.mockResolvedValueOnce({
      content: '  ',
      usage_metadata: { input_tokens: 5, output_tokens: 0 },
    });
    const generate = createLibraryTextGenerator({ db });
    await expect(generate(req(), request)).rejects.toMatchObject({ code: 'empty_completion' });
    expect(spendTokens).toHaveBeenCalledTimes(1);
  });
});
