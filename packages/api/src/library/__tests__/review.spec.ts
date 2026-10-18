import type { Response } from 'express';
import type { ServerRequest } from '../../types/http';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { createLibraryService } from '../service';
import { createLibraryHandlers } from '../routes';
import { startOfDay } from '../review';

const NOW = new Date('2026-03-10T20:30:00.000Z');

async function setup(options: { reviewPerDay?: number } = {}) {
  const fake = createFakeLibraryMethods();
  const service = createLibraryService({ methods: fake.methods, now: () => NOW, ...options });
  const { document } = await fake.methods.saveLibraryDocument('u1', {
    urlKey: 'k',
    normalizedUrl: 'https://example.test/post',
    title: 'Spaced repetition',
    siteName: 'example.test',
    contentHtml: '<p>text</p>',
    text: 'text',
    contentHash: 'h',
    wordCount: 1,
    readingMinutes: 1,
    fetchedAt: NOW,
  });
  const ids: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const made = await fake.methods.createLibraryHighlight('u1', {
      documentId: document.id,
      anchor: { exact: `Quote ${i}`, prefix: '', suffix: '', start: i, end: i + 7 },
      contentHash: 'h',
    });
    ids.push(made!.id);
  }
  return { ...fake, service, ids, document, handlers: createLibraryHandlers({ service }) };
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

const req = (overrides: Record<string, unknown> = {}) =>
  ({
    user: { id: 'u1' },
    config: { contextHub: { enabled: false, library: { enabled: true } } },
    body: {},
    query: {},
    params: {},
    ...overrides,
  }) as unknown as ServerRequest;

describe('startOfDay', () => {
  it('is the UTC midnight when no offset is known', () => {
    expect(startOfDay(NOW).toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });

  it('follows the browser: UTC+7 is already the next day at 20:30 UTC', () => {
    expect(startOfDay(NOW, -420).toISOString()).toBe('2026-03-10T17:00:00.000Z');
  });

  it('follows the browser west of UTC too', () => {
    expect(startOfDay(NOW, 300).toISOString()).toBe('2026-03-10T05:00:00.000Z');
  });

  it('ignores an offset that cannot be a timezone', () => {
    expect(startOfDay(NOW, 5000).toISOString()).toBe('2026-03-10T00:00:00.000Z');
    expect(startOfDay(NOW, 1.5).toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });
});

describe('the daily review', () => {
  it('offers up to the daily goal, each with the page it came from', async () => {
    const { service, ids, document } = await setup({ reviewPerDay: 3 });

    const review = await service.dailyReview('u1');

    expect(review.goal).toBe(3);
    expect(review.reviewedToday).toBe(0);
    expect(review.items).toHaveLength(3);
    expect(ids).toContain(review.items[0].highlight.id);
    expect(review.items[0].document).toMatchObject({
      id: document.id,
      title: 'Spaced repetition',
      siteName: 'example.test',
    });
  });

  it('shrinks as highlights are reviewed, and is empty once the goal is met', async () => {
    const { service, ids } = await setup({ reviewPerDay: 2 });
    await service.reviewHighlight('u1', ids[3], 'done');
    expect((await service.dailyReview('u1')).items).toHaveLength(1);

    await service.reviewHighlight('u1', ids[2], 'done');
    const finished = await service.dailyReview('u1');

    expect(finished.items).toEqual([]);
    expect(finished.reviewedToday).toBe(2);
  });

  it('lets the person keep going with extra, within a limit', async () => {
    const { service, ids } = await setup({ reviewPerDay: 1 });
    await service.reviewHighlight('u1', ids[3], 'done');

    const more = await service.dailyReview('u1', { extra: 2 });
    expect(more.goal).toBe(3);
    expect(more.items).toHaveLength(2);

    const capped = await service.dailyReview('u1', { extra: 100_000 });
    expect(capped.goal).toBe(101);
  });

  it('keeps a muted highlight out', async () => {
    const { service, ids } = await setup({ reviewPerDay: 10 });
    await service.reviewHighlight('u1', ids[3], 'mute');

    const review = await service.dailyReview('u1', { extra: 0 });

    expect(review.items.map((item) => item.highlight.id)).not.toContain(ids[3]);
  });

  it('never shows another person highlights', async () => {
    const { service, ids } = await setup();
    expect((await service.dailyReview('u2')).items).toEqual([]);
    expect(await service.reviewHighlight('u2', ids[0], 'done')).toBe(false);
  });
});

describe('the daily review over HTTP', () => {
  it('returns the review, reading the timezone offset and extra from the query', async () => {
    const { handlers } = await setup({ reviewPerDay: 1 });
    const out = reply();

    await handlers.dailyReview(req({ query: { offset: '-420', extra: '1' } }), out.response);

    expect(out.out.status).toBe(200);
    const body = out.out.body as { goal: number; items: unknown[] };
    expect(body.goal).toBe(2);
    expect(body.items).toHaveLength(2);
  });

  it('marks a highlight done or muted, and refuses anything else', async () => {
    const { handlers, ids } = await setup();

    const done = reply();
    await handlers.reviewHighlight(
      req({ params: { id: ids[0] }, body: { action: 'done' } }),
      done.response,
    );
    expect(done.out.status).toBe(204);

    const bad = reply();
    await handlers.reviewHighlight(
      req({ params: { id: ids[0] }, body: { action: 'delete' } }),
      bad.response,
    );
    expect(bad.out.status).toBe(400);

    const missing = reply();
    await handlers.reviewHighlight(
      req({ params: { id: 'nope' }, body: { action: 'mute' } }),
      missing.response,
    );
    expect(missing.out.status).toBe(404);
  });

  it('is off when the library is off, and needs a signed-in user', async () => {
    const { handlers } = await setup();

    const off = reply();
    await handlers.dailyReview(req({ config: { contextHub: { enabled: false } } }), off.response);
    expect(off.out.status).toBe(404);

    const anonymous = reply();
    await handlers.dailyReview(req({ user: undefined }), anonymous.response);
    expect(anonymous.out.status).toBe(401);
  });
});
