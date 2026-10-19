import type { Response } from 'express';
import type { ServerRequest } from '../../types/http';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { MAX_VIEWS, createLibraryService } from '../service';
import { createLibraryHandlers } from '../routes';

function setup() {
  const fake = createFakeLibraryMethods();
  const service = createLibraryService({ methods: fake.methods });
  return { ...fake, service, handlers: createLibraryHandlers({ service }) };
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

type ViewBody = { view: { id: string; name: string; filter: Record<string, string> } };

describe('pinned views over HTTP', () => {
  it('pins, lists, renames and removes a view', async () => {
    const { handlers } = setup();
    const made = reply();
    const filter = { location: 'later', kind: 'pdf', sort: 'shortest' };
    await handlers.createView(req({ body: { name: '  Short  reads ', filter } }), made.response);
    expect(made.out.status).toBe(201);
    const view = (made.out.body as ViewBody).view;
    expect(view.name).toBe('Short reads');
    expect(view.filter).toEqual(filter);

    const again = reply();
    await handlers.createView(req({ body: { name: 'short READS', filter: {} } }), again.response);
    expect(again.out.status).toBe(409);

    const listed = reply();
    await handlers.listViews(req(), listed.response);
    expect((listed.out.body as { views: unknown[] }).views).toHaveLength(1);

    const renamed = reply();
    await handlers.renameView(
      req({ params: { id: view.id }, body: { name: 'Quick' } }),
      renamed.response,
    );
    expect(renamed.out.status).toBe(200);
    expect((renamed.out.body as ViewBody).view.name).toBe('Quick');

    const removed = reply();
    await handlers.deleteView(req({ params: { id: view.id } }), removed.response);
    expect(removed.out.status).toBe(204);
    const gone = reply();
    await handlers.deleteView(req({ params: { id: view.id } }), gone.response);
    expect(gone.out.status).toBe(404);
  });

  it('refuses a filter it does not know', async () => {
    const { handlers } = setup();
    for (const filter of [{ kind: 'video' }, { sort: 'random' }, { location: 'trash' }, { x: 1 }]) {
      const out = reply();
      await handlers.createView(req({ body: { name: 'Bad', filter } }), out.response);
      expect(out.out.status).toBe(400);
    }
    const noName = reply();
    await handlers.createView(req({ body: { name: '   ', filter: {} } }), noName.response);
    expect(noName.out.status).toBe(400);
  });

  it('stops at the limit with a 409', async () => {
    const { handlers } = setup();
    for (let i = 0; i < MAX_VIEWS; i++) {
      await handlers.createView(req({ body: { name: `View ${i}`, filter: {} } }), reply().response);
    }
    const over = reply();
    await handlers.createView(req({ body: { name: 'One more', filter: {} } }), over.response);
    expect(over.out.status).toBe(409);
  });

  it('answers 409 when a rename clashes and 404 for a view that is not there', async () => {
    const { handlers } = setup();
    await handlers.createView(req({ body: { name: 'A', filter: {} } }), reply().response);
    const second = reply();
    await handlers.createView(req({ body: { name: 'B', filter: {} } }), second.response);
    const id = (second.out.body as ViewBody).view.id;
    const clash = reply();
    await handlers.renameView(req({ params: { id }, body: { name: 'a' } }), clash.response);
    expect(clash.out.status).toBe(409);
    const missing = reply();
    await handlers.renameView(
      req({ params: { id: 'nope' }, body: { name: 'Z' } }),
      missing.response,
    );
    expect(missing.out.status).toBe(404);
  });

  it('keeps one person from seeing or changing another one', async () => {
    const { handlers } = setup();
    const made = reply();
    await handlers.createView(req({ body: { name: 'Mine', filter: {} } }), made.response);
    const id = (made.out.body as ViewBody).view.id;
    const other = req({ user: { id: 'u2' } });
    const listed = reply();
    await handlers.listViews(other, listed.response);
    expect((listed.out.body as { views: unknown[] }).views).toEqual([]);
    const removed = reply();
    await handlers.deleteView(req({ user: { id: 'u2' }, params: { id } }), removed.response);
    expect(removed.out.status).toBe(404);
  });
});
