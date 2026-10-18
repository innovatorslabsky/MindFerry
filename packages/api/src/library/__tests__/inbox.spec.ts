import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '../../types/http';
import {
  emailKey,
  generateInboxToken,
  hashInboxToken,
  isInboxToken,
  parseInboundEmail,
  parseSender,
  textToHtml,
} from '../inbox';
import { createLibraryHandlers, createLibraryInboxAuth } from '../routes';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { createLibraryService } from '../service';

const user = 'u1';

const BODY = Array.from(
  { length: 12 },
  (_, i) =>
    `Paragraph ${i + 1} of this week's edition explains how spaced repetition strengthens memory over time and why it matters.`,
).join('</p><p>');
const NEWSLETTER_HTML = `<html><head><title>Weekly</title></head><body><article><h1>Spaced repetition weekly</h1><p>${BODY}</p></article></body></html>`;

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
    user: { id: user },
    config: { contextHub: { enabled: false, library: { enabled: true } } },
    body: {},
    query: {},
    params: {},
    ...overrides,
  }) as unknown as ServerRequest;

describe('the secret in a newsletter address', () => {
  it('is long, unguessable and recognisable, and only its hash is stored', () => {
    const a = generateInboxToken();
    const b = generateInboxToken();
    expect(a).not.toBe(b);
    expect(isInboxToken(a)).toBe(true);
    expect(hashInboxToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInboxToken(a)).not.toContain(a);
    for (const bad of [
      '',
      'short',
      'x'.repeat(33),
      'has space and symbols!!!!!!!!!!!!!!!!!!',
      42,
      null,
    ]) {
      expect(isInboxToken(bad)).toBe(false);
    }
  });
});

describe('reading what an email service posted', () => {
  it('reads the plain shape', () => {
    expect(
      parseInboundEmail({
        from: 'Ada <ada@example.com>',
        subject: ' Hello ',
        html: '<p>hi</p>',
        text: 'hi',
        messageId: '<1@x>',
        date: '2026-03-01',
      }),
    ).toEqual({
      from: 'Ada <ada@example.com>',
      fromName: 'Ada',
      fromAddress: 'ada@example.com',
      subject: 'Hello',
      html: '<p>hi</p>',
      text: 'hi',
      messageId: '<1@x>',
      date: '2026-03-01',
    });
  });

  it('reads the names Postmark uses', () => {
    const email = parseInboundEmail({
      From: '"Grace H." <grace@example.com>',
      Subject: 'Notes',
      HtmlBody: '<p>x</p>',
      TextBody: 'x',
      MessageID: 'pm-1',
    });
    expect(email).toMatchObject({
      fromName: 'Grace H.',
      fromAddress: 'grace@example.com',
      subject: 'Notes',
      html: '<p>x</p>',
      messageId: 'pm-1',
    });
  });

  it('reads the names Mailgun uses', () => {
    const email = parseInboundEmail({
      sender: 'news@example.com',
      subject: 'Digest',
      'body-html': '<p>x</p>',
      'body-plain': 'x',
      'Message-Id': '<mg@x>',
    });
    expect(email).toMatchObject({
      fromAddress: 'news@example.com',
      html: '<p>x</p>',
      text: 'x',
      messageId: '<mg@x>',
    });
  });

  it('turns away a message with no body, and anything that is not an object', () => {
    expect(parseInboundEmail({ from: 'a@b.c', subject: 'empty' })).toBeNull();
    expect(parseInboundEmail({ html: '   ' })).toBeNull();
    for (const bad of [null, 'text', 5, [], undefined]) {
      expect(parseInboundEmail(bad)).toBeNull();
    }
  });

  it('cuts oversized bodies', () => {
    const email = parseInboundEmail({ html: 'x'.repeat(3_000_000), text: 'y'.repeat(900_000) });
    expect(email?.html).toHaveLength(2_000_000);
    expect(email?.text).toHaveLength(500_000);
  });

  it('splits a sender into name and address', () => {
    expect(parseSender('Ada Lovelace <ada@example.com>')).toEqual({
      name: 'Ada Lovelace',
      address: 'ada@example.com',
    });
    expect(parseSender('ada@example.com')).toEqual({ address: 'ada@example.com' });
    expect(parseSender('Just A Name')).toEqual({ name: 'Just A Name' });
    expect(parseSender('<ada@example.com>')).toEqual({ address: 'ada@example.com' });
  });

  it('gives a message the same key every time it is delivered', () => {
    const email = parseInboundEmail({ from: 'a@b.c', subject: 's', text: 't', messageId: 'm1' })!;
    expect(emailKey(email)).toBe(emailKey({ ...email, subject: 'edited' }));
    expect(emailKey(email)).not.toBe(emailKey({ ...email, messageId: 'm2' }));
    const anonymous = { from: 'a@b.c', subject: 's', text: 't', date: 'd' };
    expect(emailKey(anonymous)).toBe(emailKey({ ...anonymous }));
    expect(emailKey(anonymous)).not.toBe(emailKey({ ...anonymous, subject: 'other' }));
  });

  it('shows plain text as paragraphs without treating it as markup', () => {
    const html = textToHtml(
      'A <b>title</b>',
      'First line\nsecond line\n\n<script>alert(1)</script>',
    );
    expect(html).toContain('<h1>A &lt;b&gt;title&lt;/b&gt;</h1>');
    expect(html).toContain('<p>First line<br>second line</p>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('saving a newsletter', () => {
  it('puts it in the Feed tab, named for its subject and sender, tagged as a newsletter', async () => {
    const { service } = setup();
    const email = parseInboundEmail({
      from: 'The Weekly <weekly@example.com>',
      subject: 'Spaced repetition weekly',
      html: NEWSLETTER_HTML,
      messageId: 'm1',
    })!;

    const saved = await service.receiveEmail(user, email);

    expect(saved.created).toBe(true);
    expect(saved.document).toMatchObject({
      title: 'Spaced repetition weekly',
      siteName: 'The Weekly',
      byline: 'weekly@example.com',
      location: 'feed',
      kind: 'article',
    });
    expect(saved.document.normalizedUrl).toMatch(/^mail:\/\/[0-9a-f]{64}$/);
    expect(saved.document.tags[0]).toBe('newsletter');
  });

  it('saves a message delivered twice once', async () => {
    const { service, methods } = setup();
    const email = parseInboundEmail({ subject: 'S', html: NEWSLETTER_HTML, messageId: 'm1' })!;

    const first = await service.receiveEmail(user, email);
    const second = await service.receiveEmail(user, email);

    expect(second.created).toBe(false);
    expect(second.document.id).toBe(first.document.id);
    expect(await methods.listLibraryDocuments(user, { limit: 10 })).toHaveLength(1);
  });

  it('reads a plain-text message when it has no HTML', async () => {
    const { service } = setup();
    const text = Array.from(
      { length: 10 },
      (_, i) => `Line ${i}: a sentence long enough to count as text in a message.`,
    ).join('\n\n');
    const email = parseInboundEmail({
      from: 'a@example.com',
      subject: 'Plain',
      text,
      messageId: 'm2',
    })!;

    const saved = await service.receiveEmail(user, email);

    expect(saved.document.title).toBe('Plain');
    expect(saved.document.siteName).toBe('example.com');
  });

  it('falls back to the text when the HTML has nothing worth reading', async () => {
    const { service } = setup();
    const text = Array.from(
      { length: 10 },
      (_, i) => `Line ${i}: a sentence long enough to count as text in a message.`,
    ).join('\n\n');
    const email = parseInboundEmail({
      subject: 'Image only',
      html: '<html><body><img src="https://x.test/a.png"></body></html>',
      text,
      messageId: 'm3',
    })!;

    const saved = await service.receiveEmail(user, email);

    expect(saved.document.wordCount).toBeGreaterThan(50);
  });

  it('keeps a newsletter to the person it was sent to', async () => {
    const { service, methods } = setup();
    const email = parseInboundEmail({ subject: 'S', html: NEWSLETTER_HTML, messageId: 'm1' })!;
    await service.receiveEmail(user, email);

    expect(await methods.listLibraryDocuments('u2', { limit: 10 })).toHaveLength(0);
  });
});

describe('the newsletter address over HTTP', () => {
  it('makes an address once, shows the secret only then, and replaces it on request', async () => {
    const { handlers, service } = setup();

    const none = reply();
    await handlers.getInbox(req(), none.response);
    expect(none.out.body).toEqual({ inbox: null });

    const made = reply();
    await handlers.rotateInbox(req(), made.response);
    expect(made.out.status).toBe(201);
    const { token } = made.out.body as { token: string };
    expect(isInboxToken(token)).toBe(true);
    expect(await service.findInboxOwner(token)).toEqual({ userId: user });

    const shown = reply();
    await handlers.getInbox(req(), shown.response);
    expect(JSON.stringify(shown.out.body)).not.toContain(token);
    expect((shown.out.body as { inbox: { createdAt: unknown } }).inbox.createdAt).toBeDefined();

    const again = reply();
    await handlers.rotateInbox(req(), again.response);
    expect(await service.findInboxOwner(token)).toBeNull();
    const fresh = (again.out.body as { token: string }).token;
    expect(await service.findInboxOwner(fresh)).toEqual({ userId: user });

    const off = reply();
    await handlers.deleteInbox(req(), off.response);
    expect(off.out.status).toBe(204);
    expect(await service.findInboxOwner(fresh)).toBeNull();
  });

  it('takes a message, and says so when it has no text or the library is off', async () => {
    const { handlers } = setup();

    const ok = reply();
    await handlers.receiveEmail(
      req({
        body: { from: 'a@example.com', subject: 'S', html: NEWSLETTER_HTML, messageId: 'm1' },
      }),
      ok.response,
    );
    expect(ok.out.status).toBe(201);

    const empty = reply();
    await handlers.receiveEmail(req({ body: { subject: 'nothing' } }), empty.response);
    expect(empty.out.status).toBe(422);

    const off = reply();
    await handlers.receiveEmail(
      req({ config: { contextHub: { enabled: false } }, body: { html: NEWSLETTER_HTML } }),
      off.response,
    );
    expect(off.out.status).toBe(404);
  });

  it('is off for someone who is not signed in', async () => {
    const { handlers } = setup();
    for (const handler of [handlers.getInbox, handlers.rotateInbox, handlers.deleteInbox]) {
      const out = reply();
      await handler(req({ user: undefined }), out.response);
      expect(out.out.status).toBe(401);
    }
  });
});

describe('finding whose address a message came to', () => {
  const run = async (
    token: unknown,
    deps: Partial<Parameters<typeof createLibraryInboxAuth>[0]> = {},
  ) => {
    const request = req({ params: { token }, user: undefined });
    const out = reply();
    const next = jest.fn() as unknown as NextFunction;
    const auth = createLibraryInboxAuth({
      findOwner: async () => ({ userId: 'u9' }),
      findUser: async () => ({ _id: 'u9', role: 'USER', email: 'a@example.com' }),
      ...deps,
    });
    await auth(request, out.response, next);
    return { request, out, next };
  };
  const token = generateInboxToken();

  it('signs the request in as the owner', async () => {
    const { request, next } = await run(token);

    expect(next).toHaveBeenCalledTimes(1);
    expect(request.user).toMatchObject({ id: 'u9', role: 'USER' });
  });

  it('answers a malformed secret, an unknown one and a vanished owner the same way', async () => {
    const malformed = await run('nope');
    const unknown = await run(token, { findOwner: async () => null });
    const gone = await run(token, { findUser: async () => null });

    for (const result of [malformed, unknown, gone]) {
      expect(result.out.out.status).toBe(404);
      expect(result.next).not.toHaveBeenCalled();
    }
    expect(malformed.out.out.body).toEqual(unknown.out.out.body);
    expect(unknown.out.out.body).toEqual(gone.out.out.body);
  });

  it('does not leak a lookup failure', async () => {
    const failed = await run(token, {
      findOwner: async () => {
        throw new Error('connection string with secret');
      },
    });

    expect(failed.out.out.status).toBe(500);
    expect(JSON.stringify(failed.out.out.body)).not.toContain('secret');
  });
});
