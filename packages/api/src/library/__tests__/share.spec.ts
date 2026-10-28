import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '../../types/http';
import { createLibraryHandlers, createLibraryShareAuth, isShareToken } from '../routes';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { createAnchor } from '../anchor/textQuote';
import { createLibraryService } from '../service';
import { getLibrarySharing } from '../config';

const owner = 'u1';
const stranger = 'u2';

const BODY = Array.from(
  { length: 12 },
  (_, i) =>
    `Paragraph ${i + 1} explains how spaced repetition strengthens memory over time and why it matters.`,
).join('</p><p>');
const HTML = `<html><head><title>Shared essay</title></head><body><article><h1>Shared essay</h1><p>${BODY}</p></article></body></html>`;

const sharingOn = {
  contextHub: { enabled: false, library: { enabled: true, sharing: { enabled: true } } },
};
const sharingOff = { contextHub: { enabled: false, library: { enabled: true } } };

function setup() {
  const fake = createFakeLibraryMethods();
  const service = createLibraryService({ methods: fake.methods });
  return { ...fake, service, handlers: createLibraryHandlers({ service }) };
}

function reply() {
  const out = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const response = {
    status(code: number) {
      out.status = code;
      return response;
    },
    json(body: unknown) {
      out.body = body;
      return response;
    },
    setHeader(name: string, value: string) {
      out.headers[name.toLowerCase()] = value;
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
    user: { id: owner },
    config: sharingOn,
    body: {},
    query: {},
    params: {},
    ...overrides,
  }) as unknown as ServerRequest;

async function sharedDocument(includeHighlights = false) {
  const ctx = setup();
  const saved = await ctx.service.saveFromHtml(owner, 'https://example.com/essay', HTML);
  const id = saved.document.id;
  await ctx.service.update(owner, id, { note: 'my private note', tags: ['secret-tag'] });
  const full = (await ctx.service.get(owner, id))!;
  await ctx.service.createHighlight(owner, {
    documentId: id,
    anchor: createAnchor(full.text, 0, 9),
    contentHash: full.contentHash,
    note: 'my private thought',
    tags: ['t'],
  });
  const share = (await ctx.service.setShare(owner, id, { includeHighlights }))!;
  return { ...ctx, id, share };
}

async function asVisitor(
  ctx: Awaited<ReturnType<typeof sharedDocument>>,
  handler: 'getShared' | 'getSharedUnit' | 'getSharedResource',
  config: unknown = sharingOn,
  extra: Record<string, unknown> = {},
) {
  const request = req({ params: { token: ctx.share.token, ...extra }, user: undefined, config });
  const target = await ctx.service.findShare(ctx.share.token);
  (request as unknown as { libraryShare: unknown }).libraryShare = target ?? undefined;
  const out = reply();
  await ctx.handlers[handler](request, out.response);
  return out;
}

describe('the sharing setting', () => {
  it('is off unless the operator turns it on, and carries the notice and report address', () => {
    expect(getLibrarySharing(undefined)).toEqual({ enabled: false });
    expect(getLibrarySharing(sharingOff as never)).toEqual({ enabled: false });
    expect(
      getLibrarySharing({
        contextHub: {
          library: { sharing: { enabled: true, notice: 'Hi', reportEmail: 'a@example.com' } },
        },
      } as never),
    ).toEqual({ enabled: true, notice: 'Hi', reportEmail: 'a@example.com' });
  });
});

describe('the owner managing a public link', () => {
  it('makes a link, keeps its address when what it shows changes, and withdraws it', async () => {
    const { service, handlers } = setup();
    const id = (await service.saveFromHtml(owner, 'https://example.com/essay', HTML)).document.id;

    const none = reply();
    await handlers.getShare(req({ params: { id } }), none.response);
    expect(none.out.body).toEqual({ enabled: true, share: null });

    const made = reply();
    await handlers.setShare(
      req({ params: { id }, body: { includeHighlights: false } }),
      made.response,
    );
    expect(made.out.status).toBe(201);
    const token = (made.out.body as { share: { token: string } }).share.token;
    expect(isShareToken(token)).toBe(true);

    const changed = reply();
    await handlers.setShare(
      req({ params: { id }, body: { includeHighlights: true } }),
      changed.response,
    );
    expect(changed.out.status).toBe(200);
    expect(changed.out.body).toMatchObject({ share: { token, includeHighlights: true } });

    const gone = reply();
    await handlers.deleteShare(req({ params: { id } }), gone.response);
    expect(gone.out.status).toBe(204);
    expect((await service.findShare(token)) ?? null).toBeNull();
  });

  it('refuses to make a link when sharing is off, but still lets one be withdrawn', async () => {
    const { service, handlers } = setup();
    const id = (await service.saveFromHtml(owner, 'https://example.com/essay', HTML)).document.id;

    const probe = reply();
    await handlers.getShare(req({ params: { id }, config: sharingOff }), probe.response);
    expect(probe.out.body).toEqual({ enabled: false });

    const refused = reply();
    await handlers.setShare(
      req({ params: { id }, config: sharingOff, body: { includeHighlights: false } }),
      refused.response,
    );
    expect(refused.out.status).toBe(403);

    const withdrawn = reply();
    await handlers.deleteShare(req({ params: { id }, config: sharingOff }), withdrawn.response);
    expect(withdrawn.out.status).toBe(204);
  });

  it('cannot share what is not the person’s, or someone who is not signed in', async () => {
    const { service, handlers } = setup();
    const id = (await service.saveFromHtml(owner, 'https://example.com/essay', HTML)).document.id;

    const theirs = reply();
    await handlers.setShare(
      req({ user: { id: stranger }, params: { id }, body: { includeHighlights: false } }),
      theirs.response,
    );
    expect(theirs.out.status).toBe(404);

    const anonymous = reply();
    await handlers.setShare(req({ user: undefined, params: { id } }), anonymous.response);
    expect(anonymous.out.status).toBe(401);

    const malformed = reply();
    await handlers.setShare(
      req({ params: { id }, body: { includeHighlights: 'yes' } }),
      malformed.response,
    );
    expect(malformed.out.status).toBe(400);
  });
});

describe('a visitor opening a public link', () => {
  it('reads the text without the owner’s note, tags or highlight notes, and is told not to be indexed', async () => {
    const ctx = await sharedDocument(true);
    const { out } = { out: await asVisitor(ctx, 'getShared') };

    expect(out.out.status).toBe(200);
    const body = out.out.body as {
      document: Record<string, unknown>;
      highlights: Array<Record<string, unknown>>;
    };
    expect(body.document).toMatchObject({ title: 'Shared essay', kind: 'article' });
    expect(String(body.document.text)).toContain('Paragraph 1');
    expect(body.document).not.toHaveProperty('note');
    expect(body.document).not.toHaveProperty('tags');
    expect(body.document).not.toHaveProperty('folderId');
    expect(body.highlights).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('my private');
    expect(JSON.stringify(body)).not.toContain('secret-tag');
    expect(out.out.headers['x-robots-tag']).toContain('noindex');
    expect(out.out.headers['cache-control']).toBe('no-store');
  });

  it('sees no highlights unless the owner chose to share them', async () => {
    const ctx = await sharedDocument(false);
    const out = await asVisitor(ctx, 'getShared');
    expect((out.out.body as { highlights: unknown[] }).highlights).toEqual([]);
  });

  it('gets the same 404 for a withdrawn link, an unknown one, or when sharing is turned off', async () => {
    const ctx = await sharedDocument(true);
    const off = await asVisitor(ctx, 'getShared', sharingOff);
    expect(off.out.status).toBe(404);

    await ctx.service.deleteShare(owner, ctx.id);
    const withdrawn = await asVisitor(ctx, 'getShared');
    expect(withdrawn.out.status).toBe(404);
    expect(withdrawn.out.body).toEqual(off.out.body);
  });

  it('cannot reach any other document of the owner through a link', async () => {
    const ctx = await sharedDocument(false);
    const other = (
      await ctx.service.saveFromHtml(
        owner,
        'https://example.com/other',
        HTML.replace('Shared essay', 'Other'),
      )
    ).document;
    const out = await asVisitor(ctx, 'getSharedUnit', sharingOn, { index: '0' });
    expect(out.out.status).toBe(404);
    expect(other.id).not.toBe(ctx.id);
  });
});

describe('finding whose document a link opens', () => {
  const run = async (
    token: unknown,
    deps: Partial<Parameters<typeof createLibraryShareAuth>[0]> = {},
  ) => {
    const request = req({ params: { token }, user: undefined });
    const out = reply();
    const next = jest.fn() as unknown as NextFunction;
    const auth = createLibraryShareAuth({
      findShare: async () => ({ userId: 'u9', documentId: 'd1', includeHighlights: false }),
      findUser: async () => ({ _id: 'u9', role: 'USER' }),
      ...deps,
    });
    await auth(request, out.response, next);
    return { request, out, next };
  };
  const token = 'A'.repeat(22);

  it('acts as the owner and remembers which document the link opens', async () => {
    const { request, next } = await run(token);
    expect(next).toHaveBeenCalledTimes(1);
    expect(request.user).toMatchObject({ id: 'u9' });
    expect(
      (request as unknown as { libraryShare: { documentId: string } }).libraryShare.documentId,
    ).toBe('d1');
  });

  it('answers a malformed token, an unknown one and a vanished owner the same way', async () => {
    const results = [
      await run('nope'),
      await run(token, { findShare: async () => null }),
      await run(token, { findUser: async () => null }),
    ];
    for (const result of results) {
      expect(result.out.out.status).toBe(404);
      expect(result.next).not.toHaveBeenCalled();
      expect(result.out.out.headers['x-robots-tag']).toContain('noindex');
    }
    expect(results[0].out.out.body).toEqual(results[1].out.out.body);
    expect(results[1].out.out.body).toEqual(results[2].out.out.body);
  });

  it('does not leak a lookup failure', async () => {
    const failed = await run(token, {
      findShare: async () => {
        throw new Error('connection string with secret');
      },
    });
    expect(failed.out.out.status).toBe(500);
    expect(JSON.stringify(failed.out.out.body)).not.toContain('secret');
  });
});
