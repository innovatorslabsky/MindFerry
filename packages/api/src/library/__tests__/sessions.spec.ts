import type { Response } from 'express';
import type { ServerRequest } from '../../types/http';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { createLibraryHandlers } from '../routes';
import { createLibraryService } from '../service';

const user = 'u1';
const SID = 'session-aaaaaaaaaaaa';

const html = (title: string) =>
  `<html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${'This essay explains why spaced repetition works and how to use it well. '.repeat(12)}</p></article></body></html>`;

function setup() {
  const fake = createFakeLibraryMethods();
  const service = createLibraryService({ methods: fake.methods });
  return { service, handlers: createLibraryHandlers({ service }) };
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
    user: { id: user },
    config: { contextHub: { enabled: false, library: { enabled: true } } },
    body: {},
    query: {},
    params: {},
    ...overrides,
  }) as unknown as ServerRequest;

const report = {
  startedAt: '2026-03-10T11:50:00.000Z',
  activeSeconds: 120,
  words: 400,
};

async function saved() {
  const ctx = setup();
  const id = (await ctx.service.saveFromHtml(user, 'https://example.com/a', html('A'))).document.id;
  return { ...ctx, id };
}

describe('reading sessions over HTTP', () => {
  it('takes a running session’s totals, and lists it with the sum of all of them', async () => {
    const { handlers, id } = await saved();
    const put = reply();
    await handlers.saveSession(req({ params: { id, sid: SID }, body: report }), put.response);
    expect(put.out.status).toBe(200);
    expect((put.out.body as { session: unknown }).session).toMatchObject({
      id: SID,
      kind: 'auto',
      activeSeconds: 120,
      words: 400,
    });

    const got = reply();
    await handlers.getSessions(req({ params: { id } }), got.response);
    expect(got.out.body).toMatchObject({ totals: { seconds: 120, words: 400, sessions: 1 } });
  });

  it('refuses a report that is not a whole number, is negative, absurdly large, or has no valid start', async () => {
    const { handlers, id } = await saved();
    for (const body of [
      { ...report, activeSeconds: -1 },
      { ...report, activeSeconds: 1.5 },
      { ...report, activeSeconds: 7 * 60 * 60 },
      { ...report, words: 600_000 },
      { ...report, startedAt: 'yesterday' },
      { activeSeconds: 5, words: 5 },
    ]) {
      const out = reply();
      await handlers.saveSession(req({ params: { id, sid: SID }, body }), out.response);
      expect(out.out.status).toBe(400);
    }
  });

  it('logs reading by hand, and deletes an entry', async () => {
    const { handlers, id } = await saved();
    const made = reply();
    await handlers.addSession(
      req({ params: { id }, body: { minutes: 25, words: 5000, date: '2026-03-01T10:00:00.000Z' } }),
      made.response,
    );
    expect(made.out.status).toBe(201);
    const session = (made.out.body as { session: { id: string; kind: string } }).session;
    expect(session.kind).toBe('manual');

    const gone = reply();
    await handlers.deleteSession(req({ params: { id, sid: session.id } }), gone.response);
    expect(gone.out.status).toBe(204);
    const again = reply();
    await handlers.deleteSession(req({ params: { id, sid: session.id } }), again.response);
    expect(again.out.status).toBe(404);
  });

  it('refuses manual time that is zero, too long, or not a number', async () => {
    const { handlers, id } = await saved();
    for (const body of [
      { minutes: 0 },
      { minutes: 1441 },
      { minutes: '30' },
      { minutes: 2.5 },
      {},
    ]) {
      const out = reply();
      await handlers.addSession(req({ params: { id }, body }), out.response);
      expect(out.out.status).toBe(400);
    }
  });

  it('is the owner’s alone, and for someone signed in', async () => {
    const { handlers, id } = await saved();
    const stranger = reply();
    await handlers.saveSession(
      req({ user: { id: 'u2' }, params: { id, sid: SID }, body: report }),
      stranger.response,
    );
    expect(stranger.out.status).toBe(404);
    const manual = reply();
    await handlers.addSession(
      req({ user: { id: 'u2' }, params: { id }, body: { minutes: 5 } }),
      manual.response,
    );
    expect(manual.out.status).toBe(404);
    for (const handler of [handlers.saveSession, handlers.addSession, handlers.readingStats]) {
      const out = reply();
      await handler(req({ user: undefined, params: { id, sid: SID }, body: report }), out.response);
      expect(out.out.status).toBe(401);
    }
  });

  it('gives the stats for a window of days, a month when none is asked for, and never more than a year', async () => {
    const { handlers } = await saved();
    const asked: number[] = [];
    const service = createLibraryService({ methods: createFakeLibraryMethods().methods });
    const original = service.readingStats.bind(service);
    service.readingStats = (userId, options) => {
      asked.push(options.days);
      return original(userId, options);
    };
    const wired = createLibraryHandlers({ service });
    for (const days of [undefined, '7', '9999', '0', 'abc']) {
      const out = reply();
      await wired.readingStats(
        req({ query: days === undefined ? {} : { days, offset: '-420' } }),
        out.response,
      );
      expect(out.out.status).toBe(200);
    }
    expect(asked).toEqual([30, 7, 366, 1, 30]);
    expect(handlers).toBeDefined();
  });
});
