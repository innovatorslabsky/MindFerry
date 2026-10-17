import type { Response } from 'express';
import type { ServerRequest } from '../../types/http';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { createLibraryHandlers } from '../routes';
import { createLibraryService } from '../service';
import { makePdf } from './helpers/pdfFixture';
import { epub3 } from './helpers/epubFixture';

const user = 'user-a';
const other = 'user-b';
const PDF = makePdf({
  title: 'A Test Paper',
  pages: [[[72, 720, 'Hello brave new world of reading']]],
});

function setup(keepPdfOriginals: boolean) {
  const fake = createFakeLibraryMethods();
  const service = createLibraryService({ methods: fake.methods, keepPdfOriginals });
  return { ...fake, service, handlers: createLibraryHandlers({ service }) };
}

function reply() {
  const out = {
    status: 0,
    body: undefined as unknown,
    ended: undefined as unknown,
    headers: {} as Record<string, string>,
  };
  const response = {
    status(code: number) {
      out.status = code;
      return response;
    },
    json(body: unknown) {
      out.body = body;
      return response;
    },
    end(body?: unknown) {
      out.ended = body ?? true;
      return response;
    },
    setHeader(name: string, value: string) {
      out.headers[name] = value;
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

describe('keeping the original of an uploaded PDF', () => {
  it('keeps nothing by default', async () => {
    const { service, sources } = setup(false);
    const saved = await service.saveUpload(user, PDF);
    expect(saved.document.hasSource).toBe(false);
    expect(sources.size).toBe(0);
    expect(await service.getSource(user, saved.document.id)).toBeNull();
  });

  it('keeps the exact bytes of a PDF when the operator turned it on', async () => {
    const { service } = setup(true);
    const saved = await service.saveUpload(user, PDF);
    expect(saved.document.hasSource).toBe(true);
    const back = await service.getSource(user, saved.document.id);
    expect(Buffer.compare(back!, Buffer.from(PDF))).toBe(0);
  });

  it('never keeps an EPUB, which has no page to show', async () => {
    const { service, sources } = setup(true);
    const saved = await service.saveUpload(user, epub3());
    expect(saved.document.hasSource).toBe(false);
    expect(sources.size).toBe(0);
  });

  it('adds the original when a PDF saved earlier is uploaded again with the setting on', async () => {
    const fake = createFakeLibraryMethods();
    const before = await createLibraryService({ methods: fake.methods }).saveUpload(user, PDF);
    expect(before.document.hasSource).toBe(false);
    const after = await createLibraryService({
      methods: fake.methods,
      keepPdfOriginals: true,
    }).saveUpload(user, PDF);
    expect(after.created).toBe(false);
    expect(after.document.hasSource).toBe(true);
  });

  it("does not hand one user another user's original", async () => {
    const { service } = setup(true);
    const saved = await service.saveUpload(user, PDF);
    expect(await service.getSource(other, saved.document.id)).toBeNull();
    expect(await service.removeSource(other, saved.document.id)).toBe(false);
  });
});

describe('source routes', () => {
  it('serves the file as a sandboxed, non-sniffed PDF that is not cached', async () => {
    const { service, handlers } = setup(true);
    const saved = await service.saveUpload(user, PDF);
    const { response, out } = reply();
    await handlers.getSource(req({ params: { id: saved.document.id } }), response);
    expect(out.status).toBe(200);
    expect(out.headers).toMatchObject({
      'Content-Type': 'application/pdf',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    expect(Buffer.compare(out.ended as Buffer, Buffer.from(PDF))).toBe(0);
  });

  it('is a 404 when nothing is stored, for someone else, or when the library is off', async () => {
    const { service, handlers } = setup(true);
    const saved = await service.saveUpload(user, PDF);
    const stranger = reply();
    await handlers.getSource(
      req({ user: { id: other }, params: { id: saved.document.id } }),
      stranger.response,
    );
    expect(stranger.out.status).toBe(404);
    const off = reply();
    await handlers.getSource(
      req({ config: { contextHub: { enabled: true } }, params: { id: saved.document.id } }),
      off.response,
    );
    expect(off.out.status).toBe(404);
    expect(off.out.ended).toBeUndefined();
    const none = reply();
    await handlers.getSource(req({ params: { id: 'missing' } }), none.response);
    expect(none.out.status).toBe(404);
  });

  it('removes only the original and leaves the document readable', async () => {
    const { service, handlers } = setup(true);
    const saved = await service.saveUpload(user, PDF);
    const first = reply();
    await handlers.removeSource(req({ params: { id: saved.document.id } }), first.response);
    expect(first.out.status).toBe(204);
    const again = reply();
    await handlers.removeSource(req({ params: { id: saved.document.id } }), again.response);
    expect(again.out.status).toBe(404);
    expect((await service.get(user, saved.document.id))?.hasSource).toBe(false);
  });
});
