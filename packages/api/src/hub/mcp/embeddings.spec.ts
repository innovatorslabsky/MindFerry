import { createOpenAICompatEmbeddingProvider, cosineSimilarity } from './embeddings';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1);
  });

  it('is undefined for mismatched dimensions', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBeUndefined();
  });

  it('is undefined for a zero vector, rather than a false 0', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBeUndefined();
    expect(cosineSimilarity([0, 0], [0, 0])).toBeUndefined();
  });

  it('is undefined for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBeUndefined();
  });
});

describe('createOpenAICompatEmbeddingProvider', () => {
  function fakeFetch(responseBody: unknown, ok = true, status = 200) {
    return jest.fn().mockResolvedValue({
      ok,
      status,
      json: jest.fn().mockResolvedValue(responseBody),
      text: jest.fn().mockResolvedValue(JSON.stringify(responseBody)),
    }) as unknown as typeof fetch;
  }

  it('posts every text in one batched request to {baseURL}/embeddings', async () => {
    const fetchFn = fakeFetch({
      data: [
        { index: 0, embedding: [1, 0] },
        { index: 1, embedding: [0, 1] },
      ],
    });
    const provider = createOpenAICompatEmbeddingProvider({
      baseURL: 'http://freellmapi:3001/v1',
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
      fetchFn,
    });

    const vectors = await provider.embed(['hello', 'world']);

    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(fetchFn).toHaveBeenCalledWith(
      'http://freellmapi:3001/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
    const [, init] = (fetchFn as unknown as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'text-embedding-3-small',
      input: ['hello', 'world'],
    });
  });

  it('trims a trailing slash from baseURL rather than double-slashing the path', async () => {
    const fetchFn = fakeFetch({ data: [{ index: 0, embedding: [1] }] });
    const provider = createOpenAICompatEmbeddingProvider({
      baseURL: 'http://freellmapi:3001/v1/',
      apiKey: 'k',
      model: 'm',
      fetchFn,
    });

    await provider.embed(['x']);

    expect(fetchFn).toHaveBeenCalledWith('http://freellmapi:3001/v1/embeddings', expect.anything());
  });

  it('reorders response vectors by their index, not response array order', async () => {
    const fetchFn = fakeFetch({
      data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ],
    });
    const provider = createOpenAICompatEmbeddingProvider({
      baseURL: 'http://x',
      apiKey: 'k',
      model: 'm',
      fetchFn,
    });

    const vectors = await provider.embed(['first', 'second']);

    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it('returns an empty array without calling fetch for no input texts', async () => {
    const fetchFn = fakeFetch({ data: [] });
    const provider = createOpenAICompatEmbeddingProvider({
      baseURL: 'http://x',
      apiKey: 'k',
      model: 'm',
      fetchFn,
    });

    expect(await provider.embed([])).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws with status and body text when the request fails', async () => {
    const fetchFn = fakeFetch({ error: 'bad key' }, false, 401);
    const provider = createOpenAICompatEmbeddingProvider({
      baseURL: 'http://x',
      apiKey: 'bad',
      model: 'm',
      fetchFn,
    });

    await expect(provider.embed(['x'])).rejects.toThrow(/401/);
  });
});
