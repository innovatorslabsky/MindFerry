import type { Response } from 'express';
import type { ServerRequest } from '../../types/http';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { createLibraryHandlers } from '../routes';
import { MAX_FOLDERS, createLibraryService } from '../service';

const HTML = `<html lang="en"><head><title>Spaced repetition</title></head><body><article><h1>Spaced repetition</h1><p>${Array.from(
  { length: 14 },
  () => 'Spaced repetition strengthens memory over time.',
).join(' ')}</p></article></body></html>`;

function setup(options: { autoTag?: boolean } = {}) {
  const fake = createFakeLibraryMethods();
  const service = createLibraryService({ methods: fake.methods, ...options });
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

describe('tagging a new document', () => {
  it('tags a saved page with its site and keywords', async () => {
    const { service } = setup();
    const saved = await service.saveFromHtml('u1', 'https://www.example.com/a', HTML);
    expect(saved.document.tags).toEqual(['example.com', 'repetition', 'spaced', 'memory']);
  });

  it('leaves the tags the person set alone when the page is saved again', async () => {
    const { service } = setup();
    const saved = await service.saveFromHtml('u1', 'https://www.example.com/a', HTML);
    await service.update('u1', saved.document.id, { tags: ['mine'] });
    const again = await service.saveFromHtml('u1', 'https://www.example.com/a', HTML);
    expect(again.document.tags).toEqual(['mine']);
  });

  it('adds no tags when the operator turned it off', async () => {
    const { service } = setup({ autoTag: false });
    const saved = await service.saveFromHtml('u1', 'https://www.example.com/a', HTML);
    expect(saved.document.tags).toEqual([]);
  });
});

describe('folders', () => {
  it('creates, lists, renames and deletes a folder over HTTP', async () => {
    const { handlers } = setup();
    const made = reply();
    await handlers.createFolder(req({ body: { name: '  Work  stuff ' } }), made.response);
    expect(made.out.status).toBe(201);
    const folder = (made.out.body as { folder: { id: string; name: string } }).folder;
    expect(folder.name).toBe('Work stuff');

    const again = reply();
    await handlers.createFolder(req({ body: { name: 'work STUFF' } }), again.response);
    expect(again.out.status).toBe(200);

    const renamed = reply();
    await handlers.renameFolder(
      req({ params: { id: folder.id }, body: { name: 'Home' } }),
      renamed.response,
    );
    expect(renamed.out.status).toBe(200);

    const listed = reply();
    await handlers.listFolders(req(), listed.response);
    expect(
      (listed.out.body as { folders: Array<{ name: string }> }).folders.map((f) => f.name),
    ).toEqual(['Home']);

    const removed = reply();
    await handlers.deleteFolder(req({ params: { id: folder.id } }), removed.response);
    expect(removed.out.status).toBe(204);
  });

  it('rejects an empty or too long name, a clash, and the folder limit', async () => {
    const { handlers, service } = setup();
    for (const name of ['', '   ', 'x'.repeat(65)]) {
      const out = reply();
      await handlers.createFolder(req({ body: { name } }), out.response);
      expect(out.out.status).toBe(400);
    }
    await service.createFolder('u1', 'A');
    const b = await service.createFolder('u1', 'B');
    if (b.status === 'limit') throw new Error('limit');
    const clash = reply();
    await handlers.renameFolder(
      req({ params: { id: b.folder.id }, body: { name: 'a' } }),
      clash.response,
    );
    expect(clash.out.status).toBe(409);
    for (let i = 0; i < MAX_FOLDERS; i++) await service.createFolder('u1', `f${i}`);
    const over = reply();
    await handlers.createFolder(req({ body: { name: 'one more' } }), over.response);
    expect(over.out.status).toBe(409);
  });

  it('files a document, lists by folder, and refuses another user’s folder or document', async () => {
    const { handlers, service } = setup();
    const saved = await service.saveFromHtml('u1', 'https://www.example.com/a', HTML);
    const mine = await service.createFolder('u1', 'Mine');
    const theirs = await service.createFolder('u2', 'Theirs');
    if (mine.status === 'limit' || theirs.status === 'limit') throw new Error('limit');

    const filed = reply();
    await handlers.patch(
      req({ params: { id: saved.document.id }, body: { folderId: mine.folder.id } }),
      filed.response,
    );
    expect(filed.out.status).toBe(200);

    const inFolder = reply();
    await handlers.list(req({ query: { folder: mine.folder.id } }), inFolder.response);
    expect((inFolder.out.body as { documents: unknown[] }).documents).toHaveLength(1);
    const unfiled = reply();
    await handlers.list(req({ query: { folder: 'none' } }), unfiled.response);
    expect((unfiled.out.body as { documents: unknown[] }).documents).toHaveLength(0);

    const wrongFolder = reply();
    await handlers.patch(
      req({ params: { id: saved.document.id }, body: { folderId: theirs.folder.id } }),
      wrongFolder.response,
    );
    expect(wrongFolder.out.status).toBe(404);
    const wrongUser = reply();
    await handlers.patch(
      req({
        user: { id: 'u2' },
        params: { id: saved.document.id },
        body: { folderId: theirs.folder.id },
      }),
      wrongUser.response,
    );
    expect(wrongUser.out.status).toBe(404);

    const out = reply();
    await handlers.patch(
      req({ params: { id: saved.document.id }, body: { folderId: null } }),
      out.response,
    );
    expect(out.out.status).toBe(200);
    expect(await service.listFolders('u2')).toHaveLength(1);
    const stranger = reply();
    await handlers.deleteFolder(
      req({ user: { id: 'u2' }, params: { id: mine.folder.id } }),
      stranger.response,
    );
    expect(stranger.out.status).toBe(404);
  });

  it('is off when the library is not enabled', async () => {
    const { handlers } = setup();
    const out = reply();
    await handlers.listFolders(req({ config: { contextHub: { enabled: true } } }), out.response);
    expect(out.out.status).toBe(404);
  });
});
