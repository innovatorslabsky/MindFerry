import { contextHubSchema } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '../../types/http';
import type { LibraryTextGenerator } from '../llm';
import { buildSummaryPrompt, cleanSummary, SUMMARY_MAX_CHARS } from '../summarize';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { getLibrarySummaryModel } from '../config';
import { createLibraryService } from '../service';
import { createLibraryHandlers } from '../routes';
import { LibraryModelError } from '../llm';

const user = 'u1';

async function setup(generateText?: LibraryTextGenerator, text = 'Spacing helps memory last.') {
  const fake = createFakeLibraryMethods();
  const saved = await fake.methods.saveLibraryDocument(user, {
    urlKey: 'k',
    normalizedUrl: 'https://example.test/k',
    title: 'About memory',
    siteName: 'example.test',
    contentHtml: `<p>${text}</p>`,
    text,
    contentHash: 'a'.repeat(64),
    wordCount: 4,
    readingMinutes: 1,
    fetchedAt: new Date(),
    tags: [],
    location: 'inbox',
  });
  const service = createLibraryService({ methods: fake.methods });
  return { id: saved.document.id, handlers: createLibraryHandlers({ service, generateText }) };
}

function reply() {
  const out = { status: 0, body: undefined as unknown };
  const response = {
    status(code: number) {
      out.status = code;
      return response;
    },
    json(body: unknown) {
      out.body = body;
      return response;
    },
    end() {
      return response;
    },
  } as unknown as Response;
  return { response, out };
}

const SERVER_MODEL = { endpoint: 'Company', model: 'small-1', perUserPerDay: 3 };

const req = (id: string, body: unknown, summary?: typeof SERVER_MODEL) =>
  ({
    user: { id: user },
    config: { contextHub: { enabled: false, library: { enabled: true, summary } } },
    body,
    query: {},
    params: { id },
  }) as unknown as ServerRequest;

const target = { endpoint: 'openAI', model: 'gpt-x' };

describe('summary prompt', () => {
  it('puts the page behind the third-party notice and says when it was cut', () => {
    const prompt = buildSummaryPrompt({ title: 'T', text: 'Body', truncated: true });
    expect(prompt).toContain('written by a third party');
    expect(prompt).toContain('<<<TEXT\nBody\nTEXT>>>');
    expect(prompt).toContain('cut short');
    expect(buildSummaryPrompt({ title: 'T', text: 'Body', truncated: false })).not.toContain(
      'cut short',
    );
  });

  it('tidies what a model returns and keeps it within the field', () => {
    expect(cleanSummary('```\nSummary: It is about sleep.\n```')).toBe('It is about sleep.');
    const long = `${'A sentence here. '.repeat(300)}`;
    const cut = cleanSummary(long);
    expect(cut.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(cut.endsWith('.')).toBe(true);
  });
});

describe('summarize handler', () => {
  it('returns the summary for the model the person picked, without saving it', async () => {
    const generateText = jest.fn<
      ReturnType<LibraryTextGenerator>,
      Parameters<LibraryTextGenerator>
    >(async () => 'Summary: Spacing makes memory last.');
    const { handlers, id } = await setup(generateText);
    const out = reply();
    await handlers.summarize(req(id, target), out.response);
    expect(out.out.status).toBe(200);
    expect(out.out.body).toEqual({ summary: 'Spacing makes memory last.' });
    const [, request] = generateText.mock.calls[0];
    expect(request).toMatchObject(target);
    expect(request.prompt).toContain('Spacing helps memory last.');
  });

  it('needs a model, and is off when no generator is wired', async () => {
    const generateText = jest.fn(async () => 'x');
    const { handlers, id } = await setup(generateText);
    const missing = reply();
    await handlers.summarize(req(id, {}), missing.response);
    expect(missing.out.status).toBe(400);
    expect((missing.out.body as { error: { code: string } }).error.code).toBe('model_required');
    expect(generateText).not.toHaveBeenCalled();

    const off = await setup(undefined);
    const gone = reply();
    await off.handlers.summarize(req(off.id, target), gone.response);
    expect(gone.out.status).toBe(404);
  });

  it('does not ask a model about a document that is not the caller’s or has no text', async () => {
    const generateText = jest.fn(async () => 'x');
    const { handlers, id } = await setup(generateText, '   ');
    const empty = reply();
    await handlers.summarize(req(id, target), empty.response);
    expect(empty.out.status).toBe(422);
    const unknown = reply();
    await handlers.summarize(req('nope', target), unknown.response);
    expect(unknown.out.status).toBe(404);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('reports a person out of credits, a model that fails, and an empty answer', async () => {
    const cases: Array<[Error | string, number, string]> = [
      [
        new LibraryModelError('insufficient_balance', 'No credits left'),
        402,
        'insufficient_balance',
      ],
      [new LibraryModelError('model_unavailable', 'Unknown endpoint'), 422, 'model_unavailable'],
      [new Error('provider exploded with a secret'), 502, 'model_failed'],
      ['   ', 502, 'model_failed'],
    ];
    for (const [outcome, status, code] of cases) {
      const { handlers, id } = await setup(async () => {
        if (typeof outcome === 'string') return outcome;
        throw outcome;
      });
      const out = reply();
      await handlers.summarize(req(id, target), out.response);
      expect(out.out.status).toBe(status);
      const body = out.out.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe(code);
      expect(JSON.stringify(body)).not.toContain('secret');
    }
  });
});

describe('the deployment’s own summary model', () => {
  it('is read from the config, with a daily allowance', () => {
    expect(getLibrarySummaryModel(undefined)).toBeUndefined();
    expect(getLibrarySummaryModel({ contextHub: { library: {} } } as never)).toBeUndefined();
    expect(
      getLibrarySummaryModel({
        contextHub: { library: { summary: { endpoint: 'Company', model: 'small-1' } } },
      } as never),
    ).toEqual({ endpoint: 'Company', model: 'small-1', perUserPerDay: 30 });
  });

  it('is validated in the config file', () => {
    const parse = (summary: unknown) =>
      contextHubSchema.safeParse({ enabled: true, library: { enabled: true, summary } });
    expect(parse(undefined).success).toBe(true);
    const ok = parse({ endpoint: 'Company', model: 'small-1' });
    expect(ok.success && ok.data?.library.summary?.perUserPerDay).toBe(30);
    expect(parse({ endpoint: '', model: 'small-1' }).success).toBe(false);
    expect(parse({ endpoint: 'Company', model: 'small-1', perUserPerDay: 0 }).success).toBe(false);
  });

  it('wins over the person’s model, at the deployment’s cost', async () => {
    const generateText = jest.fn<
      ReturnType<LibraryTextGenerator>,
      Parameters<LibraryTextGenerator>
    >(async () => 'A summary.');
    const { handlers, id } = await setup(generateText);
    const out = reply();
    await handlers.summarize(req(id, target, SERVER_MODEL), out.response);
    expect(out.out.status).toBe(200);
    const [, request] = generateText.mock.calls[0];
    expect(request).toMatchObject({ endpoint: 'Company', model: 'small-1', chargeUser: false });
  });

  it('needs nothing from the person, who may have no chat open', async () => {
    const generateText = jest.fn(async () => 'A summary.');
    const { handlers, id } = await setup(generateText);
    const out = reply();
    await handlers.summarize(req(id, {}, SERVER_MODEL), out.response);
    expect(out.out.status).toBe(200);
  });

  it('charges the person only when it is their own model', async () => {
    const generateText = jest.fn<
      ReturnType<LibraryTextGenerator>,
      Parameters<LibraryTextGenerator>
    >(async () => 'A summary.');
    const { handlers, id } = await setup(generateText);
    await handlers.summarize(req(id, target), reply().response);
    expect(generateText.mock.calls[0][1].chargeUser).toBe(true);
  });
});

describe('the daily allowance on the deployment’s model', () => {
  const call = (summary?: typeof SERVER_MODEL) => {
    const out = { status: 0, body: undefined as unknown, next: false };
    const response = {
      status(code: number) {
        out.status = code;
        return response;
      },
      json(body: unknown) {
        out.body = body;
        return response;
      },
      setHeader: () => response,
      set: () => response,
      getHeader: () => undefined,
      append: () => response,
    } as unknown as Response;
    const request = {
      ...req('x', {}, summary),
      ip: '203.0.113.9',
      app: { get: () => false },
      headers: {},
    } as unknown as ServerRequest;
    return { out, response, request };
  };

  it('stops a person after their allowance, and says why', async () => {
    const { librarySummaryLimiter } = await import('../routes');
    for (let i = 0; i < 3; i += 1) {
      const { request, response, out } = call(SERVER_MODEL);
      await new Promise<void>((resolve) =>
        librarySummaryLimiter(request as never, response, () => {
          out.next = true;
          resolve();
        }),
      );
      expect(out.next).toBe(true);
    }
    const { request, response, out } = call(SERVER_MODEL);
    await librarySummaryLimiter(request as never, response, () => {
      out.next = true;
    });
    expect(out.next).toBe(false);
    expect(out.status).toBe(429);
    expect((out.body as { error: { code: string } }).error.code).toBe('summary_limit');
  });

  it('does not count a person on their own model', async () => {
    const { librarySummaryLimiter } = await import('../routes');
    for (let i = 0; i < 10; i += 1) {
      const { request, response, out } = call(undefined);
      await librarySummaryLimiter(request as never, response, () => {
        out.next = true;
      });
      expect(out.next).toBe(true);
    }
  });
});
