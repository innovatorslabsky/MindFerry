import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { LibraryBookInput, LibraryDocumentInput, LibraryHighlightInput } from '~/types';
import librarySourceSchema, { LIBRARY_SOURCE_CHUNK_BYTES } from '~/schema/librarySource';
import { createLibraryMethods, type LibraryMethods } from './library';
import libraryHighlightSchema from '~/schema/libraryHighlight';
import libraryDocumentSchema from '~/schema/libraryDocument';
import libraryProgressSchema from '~/schema/libraryProgress';
import libraryResourceSchema from '~/schema/libraryResource';
import libraryFolderSchema from '~/schema/libraryFolder';
import libraryInboxSchema from '~/schema/libraryInbox';
import libraryShareSchema from '~/schema/libraryShare';
import libraryViewSchema from '~/schema/libraryView';
import libraryUnitSchema from '~/schema/libraryUnit';
import libraryFeedSchema from '~/schema/libraryFeed';

let mongoServer: MongoMemoryServer;
let methods: LibraryMethods;

const userA = new mongoose.Types.ObjectId().toString();
const userB = new mongoose.Types.ObjectId().toString();
const HASH = 'a'.repeat(64);
const HASH2 = 'b'.repeat(64);

const doc = (overrides: Partial<LibraryDocumentInput> = {}): LibraryDocumentInput => ({
  urlKey: 'k1',
  normalizedUrl: 'https://example.test/post',
  title: 'Spaced repetition for engineers',
  contentHtml: '<p>Memory decays on a curve.</p>',
  text: 'Memory decays on a curve.',
  contentHash: HASH,
  wordCount: 5,
  readingMinutes: 1,
  fetchedAt: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

const highlight = (documentId: string, overrides: Partial<LibraryHighlightInput> = {}) => ({
  documentId,
  anchor: { exact: 'Memory decays', prefix: '', suffix: ' on a curve.', start: 0, end: 13 },
  contentHash: HASH,
  ...overrides,
});

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  if (!mongoose.models.LibraryDocument) {
    mongoose.model('LibraryDocument', libraryDocumentSchema);
  }
  if (!mongoose.models.LibraryHighlight) {
    mongoose.model('LibraryHighlight', libraryHighlightSchema);
  }
  if (!mongoose.models.LibraryProgress) {
    mongoose.model('LibraryProgress', libraryProgressSchema);
  }
  if (!mongoose.models.LibraryUnit) {
    mongoose.model('LibraryUnit', libraryUnitSchema);
  }
  if (!mongoose.models.LibraryResource) {
    mongoose.model('LibraryResource', libraryResourceSchema);
  }
  if (!mongoose.models.LibraryFolder) {
    mongoose.model('LibraryFolder', libraryFolderSchema);
  }
  if (!mongoose.models.LibraryView) {
    mongoose.model('LibraryView', libraryViewSchema);
  }
  if (!mongoose.models.LibraryShare) {
    mongoose.model('LibraryShare', libraryShareSchema);
  }
  if (!mongoose.models.LibrarySource) {
    mongoose.model('LibrarySource', librarySourceSchema);
  }
  if (!mongoose.models.LibraryFeed) {
    mongoose.model('LibraryFeed', libraryFeedSchema);
  }
  if (!mongoose.models.LibraryInbox) {
    mongoose.model('LibraryInbox', libraryInboxSchema);
  }
  methods = createLibraryMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
});

describe('saveLibraryDocument', () => {
  it('creates a document in the inbox and reads it back', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc());
    expect(saved.created).toBe(true);
    expect(saved.contentChanged).toBe(false);
    expect(saved.document.location).toBe('inbox');
    const read = await methods.getLibraryDocument(userA, saved.document.id);
    expect(read?.contentHtml).toBe('<p>Memory decays on a curve.</p>');
  });

  it('upserts on urlKey, keeping location and tags but flagging changed content', async () => {
    const first = await methods.saveLibraryDocument(userA, doc());
    await methods.updateLibraryDocument(userA, first.document.id, {
      location: 'archive',
      tags: ['memory'],
    });
    const again = await methods.saveLibraryDocument(
      userA,
      doc({ text: 'Memory decays quickly.', contentHash: HASH2, location: 'later' }),
    );
    expect(again.created).toBe(false);
    expect(again.contentChanged).toBe(true);
    expect(again.document.id).toBe(first.document.id);
    expect(again.document.location).toBe('archive');
    expect(again.document.tags).toEqual(['memory']);
    expect(await methods.listLibraryDocuments(userA, { limit: 10 })).toHaveLength(1);
  });

  it('does not report a change when the same content is saved again', async () => {
    await methods.saveLibraryDocument(userA, doc());
    const again = await methods.saveLibraryDocument(userA, doc());
    expect(again.contentChanged).toBe(false);
  });

  it('keeps the same urlKey separate between users', async () => {
    await methods.saveLibraryDocument(userA, doc());
    const b = await methods.saveLibraryDocument(userB, doc());
    expect(b.created).toBe(true);
  });
});

describe('listing and search', () => {
  it('lists without bodies, filters by location, newest first', async () => {
    await methods.saveLibraryDocument(userA, doc({ urlKey: 'a', title: 'Alpha' }));
    await methods.saveLibraryDocument(
      userA,
      doc({ urlKey: 'b', title: 'Beta', location: 'later' }),
    );
    const all = await methods.listLibraryDocuments(userA, { limit: 10 });
    expect(all.map((d) => d.title)).toEqual(['Beta', 'Alpha']);
    expect(all[0]).not.toHaveProperty('contentHtml');
    expect(all[0]).not.toHaveProperty('text');
    const later = await methods.listLibraryDocuments(userA, { location: 'later', limit: 10 });
    expect(later.map((d) => d.title)).toEqual(['Beta']);
  });

  it("searches only the caller's documents, and a blank query matches nothing", async () => {
    await methods.saveLibraryDocument(userA, doc({ urlKey: 'a', title: 'Zettelkasten notes' }));
    await methods.saveLibraryDocument(userB, doc({ urlKey: 'b', title: 'Zettelkasten rivals' }));
    const found = await methods.searchLibraryDocuments(userA, 'zettelkasten', 10);
    expect(found.map((d) => d.title)).toEqual(['Zettelkasten notes']);
    expect(await methods.searchLibraryDocuments(userA, '   ', 10)).toEqual([]);
  });
});

describe('ownership', () => {
  it("hides, refuses to update and refuses to delete another user's document", async () => {
    const { document } = await methods.saveLibraryDocument(userA, doc());
    expect(await methods.getLibraryDocument(userB, document.id)).toBeNull();
    expect(
      await methods.updateLibraryDocument(userB, document.id, { location: 'archive' }),
    ).toBeNull();
    expect(await methods.deleteLibraryDocument(userB, document.id)).toBe(false);
    expect(await methods.getLibraryDocument(userA, document.id)).not.toBeNull();
  });

  it('treats a malformed id as not found', async () => {
    expect(await methods.getLibraryDocument(userA, 'nope')).toBeNull();
    expect(await methods.deleteLibraryDocument(userA, 'nope')).toBe(false);
    expect(await methods.listLibraryHighlights(userA, 'nope')).toEqual([]);
  });

  it('refuses a highlight or progress on a document the user does not own', async () => {
    const { document } = await methods.saveLibraryDocument(userA, doc());
    expect(await methods.createLibraryHighlight(userB, highlight(document.id))).toBeNull();
    expect(await methods.setLibraryProgress(userB, document.id, 3, HASH)).toBeNull();
  });
});

describe('highlights', () => {
  it('creates, lists, patches and deletes', async () => {
    const { document } = await methods.saveLibraryDocument(userA, doc());
    const created = await methods.createLibraryHighlight(
      userA,
      highlight(document.id, { note: 'key idea', tags: ['x'] }),
    );
    expect(created).toMatchObject({ color: 'yellow', orphaned: false, note: 'key idea' });
    const listed = await methods.listLibraryHighlights(userA, document.id);
    expect(listed).toHaveLength(1);

    const patched = await methods.updateLibraryHighlight(userA, created!.id, {
      color: 'blue',
      note: null,
    });
    expect(patched?.color).toBe('blue');
    expect(patched?.note).toBeUndefined();

    expect(await methods.updateLibraryHighlight(userB, created!.id, { color: 'red' })).toBeNull();
    expect(await methods.deleteLibraryHighlight(userB, created!.id)).toBe(false);
    expect(await methods.deleteLibraryHighlight(userA, created!.id)).toBe(true);
    expect(await methods.listLibraryHighlights(userA, document.id)).toEqual([]);
  });

  it('keeps unit coordinates for chapter and page highlights', async () => {
    const { document } = await methods.saveLibraryDocument(userA, doc());
    const created = await methods.createLibraryHighlight(
      userA,
      highlight(document.id, { unit: { kind: 'page', index: 4 } }),
    );
    expect(created?.unit).toEqual({ kind: 'page', index: 4 });
  });

  it('re-anchors what resolved and orphans what did not, without deleting either', async () => {
    const { document } = await methods.saveLibraryDocument(userA, doc());
    const kept = (await methods.createLibraryHighlight(userA, highlight(document.id)))!;
    const lost = (await methods.createLibraryHighlight(userA, highlight(document.id)))!;
    const modified = await methods.reanchorLibraryHighlights(userA, document.id, [
      {
        id: kept.id,
        anchor: { exact: 'Memory decays', prefix: 'x', suffix: 'y', start: 10, end: 23 },
        contentHash: HASH2,
      },
      { id: lost.id, anchor: null, contentHash: HASH2 },
      { id: 'not-an-id', anchor: null, contentHash: HASH2 },
    ]);
    expect(modified).toBe(2);
    const byId = new Map(
      (await methods.listLibraryHighlights(userA, document.id)).map((h) => [h.id, h]),
    );
    expect(byId.get(kept.id)).toMatchObject({ orphaned: false, contentHash: HASH2 });
    expect(byId.get(kept.id)?.anchor.start).toBe(10);
    expect(byId.get(lost.id)).toMatchObject({ orphaned: true, contentHash: HASH });
  });

  it("will not re-anchor another user's highlight", async () => {
    const { document } = await methods.saveLibraryDocument(userA, doc());
    const h = (await methods.createLibraryHighlight(userA, highlight(document.id)))!;
    const modified = await methods.reanchorLibraryHighlights(userB, document.id, [
      { id: h.id, anchor: null, contentHash: HASH2 },
    ]);
    expect(modified).toBe(0);
    expect((await methods.listLibraryHighlights(userA, document.id))[0].orphaned).toBe(false);
  });
});

describe('reading progress', () => {
  it('stores one offset per document and overwrites it', async () => {
    const { document } = await methods.saveLibraryDocument(userA, doc());
    expect(await methods.getLibraryProgress(userA, document.id)).toBeNull();
    await methods.setLibraryProgress(userA, document.id, 120, HASH);
    const second = await methods.setLibraryProgress(userA, document.id, 300, HASH);
    expect(second?.textOffset).toBe(300);
    expect(await mongoose.models.LibraryProgress.countDocuments({})).toBe(1);
  });
});

describe('deletion', () => {
  it('deleting a document removes its highlights and progress', async () => {
    const { document } = await methods.saveLibraryDocument(userA, doc());
    await methods.createLibraryHighlight(userA, highlight(document.id));
    await methods.setLibraryProgress(userA, document.id, 5, HASH);
    expect(await methods.deleteLibraryDocument(userA, document.id)).toBe(true);
    expect(await mongoose.models.LibraryHighlight.countDocuments({})).toBe(0);
    expect(await mongoose.models.LibraryProgress.countDocuments({})).toBe(0);
  });

  it('deleteAllLibraryData wipes one user and leaves the others', async () => {
    const a = await methods.saveLibraryDocument(userA, doc());
    const b = await methods.saveLibraryDocument(userB, doc());
    await methods.createLibraryHighlight(userA, highlight(a.document.id));
    await methods.createLibraryHighlight(userB, highlight(b.document.id));
    await methods.setLibraryProgress(userA, a.document.id, 1, HASH);
    expect(await methods.deleteAllLibraryData(userA)).toEqual({
      documents: 1,
      highlights: 1,
      progress: 1,
      units: 0,
      resources: 0,
      sources: 0,
      folders: 0,
      feeds: 0,
      inboxes: 0,
      views: 0,
      shares: 0,
    });
    expect(await methods.listLibraryDocuments(userB, { limit: 10 })).toHaveLength(1);
    expect(await methods.listLibraryHighlights(userB)).toHaveLength(1);
  });
});

const book = (overrides: Partial<LibraryBookInput> = {}): LibraryBookInput => ({
  ...doc({
    urlKey: 'book1',
    normalizedUrl: 'upload://book1',
    title: 'A short book',
    contentHtml: '',
    text: 'Chapter one text. Chapter two text.',
    contentHash: HASH,
  }),
  kind: 'epub',
  toc: [
    { title: 'One', depth: 0, unitIndex: 0 },
    { title: 'Two', depth: 0, unitIndex: 1, fragment: 'part' },
  ],
  units: [
    {
      index: 0,
      kind: 'chapter',
      title: 'One',
      contentHtml: '<p>Chapter one text.</p>',
      text: 'Chapter one text.',
      wordCount: 3,
      contentHash: 'c'.repeat(64),
    },
    {
      index: 1,
      kind: 'chapter',
      title: 'Two',
      contentHtml: '<p>Chapter two text.</p>',
      text: 'Chapter two text.',
      wordCount: 3,
      contentHash: 'd'.repeat(64),
    },
  ],
  ...overrides,
});

describe('books (EPUB and PDF)', () => {
  it('stores the document with its table of contents and units, listed without text', async () => {
    const saved = await methods.saveLibraryBook(userA, book());
    expect(saved.created).toBe(true);
    expect(saved.document).toMatchObject({ kind: 'epub', unitCount: 2 });
    expect(saved.document.toc).toEqual([
      { title: 'One', depth: 0, unitIndex: 0 },
      { title: 'Two', depth: 0, unitIndex: 1, fragment: 'part' },
    ]);
    const units = await methods.listLibraryUnits(userA, saved.document.id);
    expect(units.map((u) => u.title)).toEqual(['One', 'Two']);
    expect(units[0]).not.toHaveProperty('text');
    expect(units[0]).not.toHaveProperty('contentHtml');
  });

  it('reads one unit with its text, and nothing for a bad index or another user', async () => {
    const { document } = await methods.saveLibraryBook(userA, book());
    const unit = await methods.getLibraryUnit(userA, document.id, 1);
    expect(unit).toMatchObject({
      text: 'Chapter two text.',
      contentHtml: '<p>Chapter two text.</p>',
    });
    expect(await methods.getLibraryUnit(userA, document.id, 9)).toBeNull();
    expect(await methods.getLibraryUnit(userA, document.id, -1)).toBeNull();
    expect(await methods.getLibraryUnit(userA, document.id, 1.5)).toBeNull();
    expect(await methods.getLibraryUnit(userB, document.id, 1)).toBeNull();
    expect(await methods.listLibraryUnits(userB, document.id)).toEqual([]);
    expect(await methods.getLibraryUnit(userA, 'nope', 0)).toBeNull();
  });

  it('keeps a PDF page as one text, with no HTML', async () => {
    const { document } = await methods.saveLibraryBook(
      userA,
      book({
        urlKey: 'pdf1',
        kind: 'pdf',
        needsOcr: false,
        truncated: true,
        units: [
          {
            index: 0,
            kind: 'page',
            text: 'reflowed page text',
            wordCount: 3,
            contentHash: 'e'.repeat(64),
          },
        ],
      }),
    );
    expect(document).toMatchObject({ kind: 'pdf', unitCount: 1, truncated: true, needsOcr: false });
    const page = await methods.getLibraryUnit(userA, document.id, 0);
    expect(page).toMatchObject({
      kind: 'page',
      text: 'reflowed page text',
      contentHtml: '',
    });
  });

  it('does not rewrite units when the same book is saved again, but repairs a partial save', async () => {
    const first = await methods.saveLibraryBook(userA, book());
    const again = await methods.saveLibraryBook(userA, book());
    expect(again.created).toBe(false);
    expect(again.document.id).toBe(first.document.id);
    expect(await mongoose.models.LibraryUnit.countDocuments({})).toBe(2);

    await mongoose.models.LibraryUnit.deleteOne({ index: 1 });
    await methods.saveLibraryBook(userA, book());
    expect(await mongoose.models.LibraryUnit.countDocuments({})).toBe(2);
  });

  it('replaces the units when the content changed', async () => {
    const { document } = await methods.saveLibraryBook(userA, book());
    const revised = book({
      contentHash: HASH2,
      units: [
        {
          index: 0,
          kind: 'chapter',
          title: 'Only',
          contentHtml: '<p>Rewritten.</p>',
          text: 'Rewritten.',
          wordCount: 1,
          contentHash: 'f'.repeat(64),
        },
      ],
    });
    const result = await methods.saveLibraryBook(userA, revised);
    expect(result.contentChanged).toBe(true);
    expect(result.document.unitCount).toBe(1);
    expect((await methods.listLibraryUnits(userA, document.id)).map((u) => u.title)).toEqual([
      'Only',
    ]);
  });

  it('lists a book among documents without its text, and finds it by title', async () => {
    await methods.saveLibraryBook(userA, book());
    const listed = await methods.listLibraryDocuments(userA, { limit: 10 });
    expect(listed[0]).toMatchObject({ kind: 'epub', unitCount: 2 });
    expect(listed[0]).not.toHaveProperty('text');
    expect((await methods.searchLibraryDocuments(userA, 'short book', 10)).length).toBe(1);
  });

  it('remembers which unit the reader was in, and clears it for a plain article', async () => {
    const { document } = await methods.saveLibraryBook(userA, book());
    const inUnit = await methods.setLibraryProgress(userA, document.id, 4, 'd'.repeat(64), 1);
    expect(inUnit).toMatchObject({ unitIndex: 1, textOffset: 4 });
    const article = await methods.saveLibraryDocument(userA, doc());
    await methods.setLibraryProgress(userA, article.document.id, 4, HASH, 3);
    const cleared = await methods.setLibraryProgress(userA, article.document.id, 9, HASH);
    expect(cleared).toMatchObject({ textOffset: 9 });
    expect(cleared).not.toHaveProperty('unitIndex');
  });

  it('deleting a book removes its units, highlights and progress, and only its own', async () => {
    const a = await methods.saveLibraryBook(userA, book());
    const b = await methods.saveLibraryBook(userB, book());
    expect(await methods.deleteLibraryDocument(userB, a.document.id)).toBe(false);
    expect(await methods.deleteLibraryDocument(userA, a.document.id)).toBe(true);
    expect(await mongoose.models.LibraryUnit.countDocuments({})).toBe(2);
    expect(await methods.listLibraryUnits(userB, b.document.id)).toHaveLength(2);
    expect(await methods.deleteAllLibraryData(userB)).toMatchObject({ documents: 1, units: 2 });
  });

  it('accepts a highlight carrying a unit coordinate on a book', async () => {
    const { document } = await methods.saveLibraryBook(userA, book());
    const created = await methods.createLibraryHighlight(
      userA,
      highlight(document.id, { unit: { kind: 'chapter', index: 1 } }),
    );
    expect(created?.unit).toEqual({ kind: 'chapter', index: 1 });
  });
});

describe('book images', () => {
  const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
  const JPG = Uint8Array.from([255, 216, 255, 224, 9, 9, 9]);
  const withImages = (overrides: Partial<LibraryBookInput> = {}) =>
    book({
      resources: [
        { path: 'OEBPS/images/a.png', mediaType: 'image/png', bytes: PNG },
        { path: 'OEBPS/images/b.jpg', mediaType: 'image/jpeg', bytes: JPG },
      ],
      ...overrides,
    });

  it('stores images with the book and reads one back, byte for byte', async () => {
    const { document } = await methods.saveLibraryBook(userA, withImages());
    const png = await methods.getLibraryResource(userA, document.id, 'OEBPS/images/a.png');
    expect(png?.mediaType).toBe('image/png');
    expect(Buffer.isBuffer(png?.bytes)).toBe(true);
    expect([...(png?.bytes as Buffer)]).toEqual([...PNG]);
    const jpg = await methods.getLibraryResource(userA, document.id, 'OEBPS/images/b.jpg');
    expect(jpg?.mediaType).toBe('image/jpeg');
  });

  it('answers nothing for an unknown path, a bad id, or another user\u2019s book', async () => {
    const { document } = await methods.saveLibraryBook(userA, withImages());
    expect(
      await methods.getLibraryResource(userA, document.id, 'OEBPS/images/nope.png'),
    ).toBeNull();
    expect(await methods.getLibraryResource(userA, 'nope', 'OEBPS/images/a.png')).toBeNull();
    expect(await methods.getLibraryResource(userA, document.id, '')).toBeNull();
    expect(await methods.getLibraryResource(userB, document.id, 'OEBPS/images/a.png')).toBeNull();
  });

  it('keeps the same image path in two books apart', async () => {
    const first = await methods.saveLibraryBook(userA, withImages());
    const second = await methods.saveLibraryBook(
      userA,
      withImages({
        urlKey: 'book2',
        normalizedUrl: 'upload://book2',
        resources: [
          {
            path: 'OEBPS/images/a.png',
            mediaType: 'image/gif',
            bytes: Uint8Array.from([71, 73, 70]),
          },
        ],
      }),
    );
    expect(
      (await methods.getLibraryResource(userA, first.document.id, 'OEBPS/images/a.png'))?.mediaType,
    ).toBe('image/png');
    expect(
      (await methods.getLibraryResource(userA, second.document.id, 'OEBPS/images/a.png'))
        ?.mediaType,
    ).toBe('image/gif');
  });

  it('does not rewrite images on an identical save, and repairs a missing one', async () => {
    await methods.saveLibraryBook(userA, withImages());
    await methods.saveLibraryBook(userA, withImages());
    expect(await mongoose.models.LibraryResource.countDocuments({})).toBe(2);
    await mongoose.models.LibraryResource.deleteOne({ path: 'OEBPS/images/b.jpg' });
    await methods.saveLibraryBook(userA, withImages());
    expect(await mongoose.models.LibraryResource.countDocuments({})).toBe(2);
  });

  it('replaces the images when the book changes', async () => {
    const { document } = await methods.saveLibraryBook(userA, withImages());
    await methods.saveLibraryBook(userA, withImages({ contentHash: HASH2, resources: [] }));
    expect(await methods.getLibraryResource(userA, document.id, 'OEBPS/images/a.png')).toBeNull();
  });

  it('stores many images in several writes', async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      path: `OEBPS/images/${i}.png`,
      mediaType: 'image/png' as const,
      bytes: PNG,
    }));
    const { document } = await methods.saveLibraryBook(userA, withImages({ resources: many }));
    expect(await mongoose.models.LibraryResource.countDocuments({})).toBe(11);
    expect(
      await methods.getLibraryResource(userA, document.id, 'OEBPS/images/10.png'),
    ).not.toBeNull();
  });

  it('removes a book\u2019s images with it, and all of a user\u2019s on deleteAll', async () => {
    const a = await methods.saveLibraryBook(userA, withImages());
    await methods.saveLibraryBook(userB, withImages());
    expect(await methods.deleteLibraryDocument(userA, a.document.id)).toBe(true);
    expect(await mongoose.models.LibraryResource.countDocuments({})).toBe(2);
    expect(await methods.deleteAllLibraryData(userB)).toMatchObject({ resources: 2 });
    expect(await mongoose.models.LibraryResource.countDocuments({})).toBe(0);
  });

  it('refuses a media type that is not a raster image', async () => {
    await expect(
      methods.saveLibraryBook(
        userA,
        withImages({
          resources: [
            {
              path: 'x.svg',
              mediaType: 'image/svg+xml' as 'image/png',
              bytes: Uint8Array.from([60, 115]),
            },
          ],
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('tags', () => {
  it('lists only documents carrying a tag, for the caller only', async () => {
    const a = await methods.saveLibraryDocument(userA, doc({ urlKey: 'a', title: 'A' }));
    const b = await methods.saveLibraryDocument(userA, doc({ urlKey: 'b', title: 'B' }));
    const other = await methods.saveLibraryDocument(userB, doc({ urlKey: 'c', title: 'C' }));
    await methods.updateLibraryDocument(userA, a.document.id, { tags: ['memory', 'ai'] });
    await methods.updateLibraryDocument(userA, b.document.id, { tags: ['ai'] });
    await methods.updateLibraryDocument(userB, other.document.id, { tags: ['memory'] });
    const memory = await methods.listLibraryDocuments(userA, { tag: 'memory', limit: 10 });
    expect(memory.map((d) => d.title)).toEqual(['A']);
    const ai = await methods.listLibraryDocuments(userA, { tag: 'ai', limit: 10 });
    expect(ai.map((d) => d.title).sort()).toEqual(['A', 'B']);
    expect(await methods.listLibraryDocuments(userA, { tag: 'none', limit: 10 })).toEqual([]);
  });

  it('combines a tag with a location', async () => {
    const a = await methods.saveLibraryDocument(userA, doc({ urlKey: 'a', title: 'A' }));
    const b = await methods.saveLibraryDocument(userA, doc({ urlKey: 'b', title: 'B' }));
    for (const saved of [a, b]) {
      await methods.updateLibraryDocument(userA, saved.document.id, { tags: ['ai'] });
    }
    await methods.updateLibraryDocument(userA, b.document.id, { location: 'archive' });
    const found = await methods.listLibraryDocuments(userA, {
      tag: 'ai',
      location: 'archive',
      limit: 10,
    });
    expect(found.map((d) => d.title)).toEqual(['B']);
  });
});

describe('followed feeds', () => {
  const feed = (overrides = {}) => ({
    feedUrl: 'https://example.test/feed.xml',
    title: 'Notes',
    siteUrl: 'https://example.test/',
    ...overrides,
  });

  it('follows a feed once, however many times it is added', async () => {
    const first = await methods.addLibraryFeed(userA, feed(), 10);
    expect(first).toMatchObject({ status: 'added', feed: { title: 'Notes' } });
    const again = await methods.addLibraryFeed(userA, feed({ title: 'Renamed' }), 10);
    expect(again).toMatchObject({ status: 'exists', feed: { title: 'Notes' } });
    expect(await methods.listLibraryFeeds(userA)).toHaveLength(1);
  });

  it('lets two people follow the same feed, privately', async () => {
    await methods.addLibraryFeed(userA, feed(), 10);
    const b = await methods.addLibraryFeed(userB, feed(), 10);
    expect(b.status).toBe('added');
    expect(await methods.listLibraryFeeds(userA)).toHaveLength(1);
    expect(await methods.listLibraryFeeds(userB)).toHaveLength(1);
  });

  it('stops following at the limit, but still recognises one already followed', async () => {
    await methods.addLibraryFeed(userA, feed({ feedUrl: 'https://a.test/f' }), 2);
    await methods.addLibraryFeed(userA, feed({ feedUrl: 'https://b.test/f' }), 2);
    expect(await methods.addLibraryFeed(userA, feed({ feedUrl: 'https://c.test/f' }), 2)).toEqual({
      status: 'limit',
    });
    expect(
      (await methods.addLibraryFeed(userA, feed({ feedUrl: 'https://a.test/f' }), 2)).status,
    ).toBe('exists');
    expect(await methods.listLibraryFeeds(userA)).toHaveLength(2);
  });

  it('remembers what a refresh saw: validators, new keys, and a capped list of keys', async () => {
    const added = await methods.addLibraryFeed(userA, feed(), 10);
    const id = (added as { feed: { id: string } }).feed.id;
    expect(
      await methods.recordLibraryFeedRefresh(userA, id, {
        etag: 'W/"1"',
        lastModified: 'Mon',
        newKeys: ['k1', 'k2'],
        title: 'Notes (renamed)',
      }),
    ).toBe(true);
    const state = await methods.getLibraryFeed(userA, id);
    expect(state).toMatchObject({
      title: 'Notes (renamed)',
      etag: 'W/"1"',
      lastModified: 'Mon',
      seenKeys: ['k1', 'k2'],
    });
    expect(state?.lastRefreshedAt).toBeInstanceOf(Date);
    await methods.recordLibraryFeedRefresh(userA, id, { etag: null, newKeys: ['k3'] });
    const next = await methods.getLibraryFeed(userA, id);
    expect(next?.seenKeys).toEqual(['k1', 'k2', 'k3']);
    expect(next).not.toHaveProperty('etag');
    expect(next?.lastModified).toBe('Mon');
    const many = Array.from({ length: 520 }, (_, i) => `n${i}`);
    await methods.recordLibraryFeedRefresh(userA, id, { newKeys: many });
    const capped = await methods.getLibraryFeed(userA, id);
    expect(capped?.seenKeys).toHaveLength(500);
    expect(capped?.seenKeys[capped.seenKeys.length - 1]).toBe('n519');
  });

  it('will not read, refresh or delete another user\u2019s feed', async () => {
    const added = await methods.addLibraryFeed(userA, feed(), 10);
    const id = (added as { feed: { id: string } }).feed.id;
    expect(await methods.getLibraryFeed(userB, id)).toBeNull();
    expect(await methods.recordLibraryFeedRefresh(userB, id, { newKeys: ['x'] })).toBe(false);
    expect(await methods.deleteLibraryFeed(userB, id)).toBe(false);
    expect(await methods.getLibraryFeed(userA, id)).not.toBeNull();
    expect(await methods.deleteLibraryFeed(userA, id)).toBe(true);
    expect(await methods.deleteLibraryFeed(userA, 'nope')).toBe(false);
    expect(await methods.getLibraryFeed(userA, 'nope')).toBeNull();
  });

  it('is removed with the rest of a user\u2019s library', async () => {
    await methods.addLibraryFeed(userA, feed(), 10);
    await methods.addLibraryFeed(userB, feed(), 10);
    expect(await methods.deleteAllLibraryData(userA)).toMatchObject({ feeds: 1 });
    expect(await methods.listLibraryFeeds(userB)).toHaveLength(1);
  });
});

describe('stored PDF originals', () => {
  const pdfBook = () => book({ kind: 'pdf', urlKey: 'upload://pdf1' });
  const bytes = (length: number) => Uint8Array.from({ length }, (_, i) => i % 251);

  it('is off for a document until an original is stored, then marks it', async () => {
    const saved = await methods.saveLibraryBook(userA, pdfBook());
    expect(saved.document.hasSource).toBe(false);
    expect(await methods.getLibrarySource(userA, saved.document.id)).toBeNull();
    expect(await methods.saveLibrarySource(userA, saved.document.id, bytes(1000))).toBe(true);
    expect((await methods.getLibraryDocument(userA, saved.document.id))?.hasSource).toBe(true);
    const back = await methods.getLibrarySource(userA, saved.document.id);
    expect(Buffer.compare(back!, Buffer.from(bytes(1000)))).toBe(0);
  });

  it('splits a file over the chunk size and puts it back together exactly', async () => {
    const saved = await methods.saveLibraryBook(userA, pdfBook());
    const big = bytes(LIBRARY_SOURCE_CHUNK_BYTES * 2 + 123);
    await methods.saveLibrarySource(userA, saved.document.id, big);
    expect(await mongoose.models.LibrarySource.countDocuments({})).toBe(3);
    const back = await methods.getLibrarySource(userA, saved.document.id);
    expect(back!.length).toBe(big.length);
    expect(Buffer.compare(back!, Buffer.from(big))).toBe(0);
  });

  it('replaces an earlier copy rather than adding to it', async () => {
    const saved = await methods.saveLibraryBook(userA, pdfBook());
    await methods.saveLibrarySource(
      userA,
      saved.document.id,
      bytes(LIBRARY_SOURCE_CHUNK_BYTES + 5),
    );
    await methods.saveLibrarySource(userA, saved.document.id, bytes(10));
    expect(await mongoose.models.LibrarySource.countDocuments({})).toBe(1);
    expect((await methods.getLibrarySource(userA, saved.document.id))!.length).toBe(10);
  });

  it("refuses another user's document, an article, and an empty file", async () => {
    const pdf = await methods.saveLibraryBook(userA, pdfBook());
    const article = await methods.saveLibraryDocument(userA, doc());
    expect(await methods.saveLibrarySource(userB, pdf.document.id, bytes(10))).toBe(false);
    expect(await methods.saveLibrarySource(userA, article.document.id, bytes(10))).toBe(false);
    expect(await methods.saveLibrarySource(userA, pdf.document.id, new Uint8Array())).toBe(false);
    await methods.saveLibrarySource(userA, pdf.document.id, bytes(10));
    expect(await methods.getLibrarySource(userB, pdf.document.id)).toBeNull();
    expect(await methods.deleteLibrarySource(userB, pdf.document.id)).toBe(false);
    expect(await methods.getLibrarySource(userA, pdf.document.id)).not.toBeNull();
  });

  it('can be dropped on its own, keeping the text and highlights', async () => {
    const saved = await methods.saveLibraryBook(userA, pdfBook());
    await methods.saveLibrarySource(userA, saved.document.id, bytes(10));
    expect(await methods.deleteLibrarySource(userA, saved.document.id)).toBe(true);
    expect(await methods.deleteLibrarySource(userA, saved.document.id)).toBe(false);
    const after = await methods.getLibraryDocument(userA, saved.document.id);
    expect(after?.hasSource).toBe(false);
    expect(await methods.getLibraryUnit(userA, saved.document.id, 0)).not.toBeNull();
  });

  it('goes with the document, and with the account', async () => {
    const one = await methods.saveLibraryBook(userA, pdfBook());
    await methods.saveLibrarySource(userA, one.document.id, bytes(10));
    await methods.deleteLibraryDocument(userA, one.document.id);
    expect(await mongoose.models.LibrarySource.countDocuments({})).toBe(0);
    const two = await methods.saveLibraryBook(userB, pdfBook());
    await methods.saveLibrarySource(userB, two.document.id, bytes(10));
    expect(await methods.deleteAllLibraryData(userB)).toMatchObject({ sources: 1 });
  });
});

describe('initial tags', () => {
  it('applies the tags given to a new document, and never changes them on a re-save', async () => {
    const first = await methods.saveLibraryDocument(
      userA,
      doc({ tags: ['example.com', 'memory'] }),
    );
    expect(first.document.tags).toEqual(['example.com', 'memory']);
    await methods.updateLibraryDocument(userA, first.document.id, { tags: ['mine'] });
    const again = await methods.saveLibraryDocument(
      userA,
      doc({ tags: ['example.com', 'memory'] }),
    );
    expect(again.created).toBe(false);
    expect(again.document.tags).toEqual(['mine']);
  });
});

describe('folders', () => {
  it('creates a folder once per name, ignoring case and spacing', async () => {
    const a = await methods.createLibraryFolder(userA, '  Psychology ', 10);
    expect(a).toMatchObject({
      status: 'created',
      folder: { name: 'Psychology', documentCount: 0 },
    });
    const b = await methods.createLibraryFolder(userA, 'psychology', 10);
    expect(b).toMatchObject({ status: 'exists' });
    expect((await methods.listLibraryFolders(userA)).length).toBe(1);
    expect((await methods.createLibraryFolder(userB, 'Psychology', 10)).status).toBe('created');
  });

  it('stops at the folder limit', async () => {
    await methods.createLibraryFolder(userA, 'one', 2);
    await methods.createLibraryFolder(userA, 'two', 2);
    expect((await methods.createLibraryFolder(userA, 'three', 2)).status).toBe('limit');
  });

  it('files a document, filters by folder, counts, and unfiles', async () => {
    const folder = await methods.createLibraryFolder(userA, 'Work', 10);
    if (folder.status === 'limit') throw new Error('limit');
    const one = await methods.saveLibraryDocument(userA, doc({ urlKey: 'f1' }));
    await methods.saveLibraryDocument(userA, doc({ urlKey: 'f2' }));
    const filed = await methods.updateLibraryDocument(userA, one.document.id, {
      folderId: folder.folder.id,
    });
    expect(filed?.folderId).toBe(folder.folder.id);
    expect(
      await methods.listLibraryDocuments(userA, { folder: folder.folder.id, limit: 10 }),
    ).toHaveLength(1);
    expect(await methods.listLibraryDocuments(userA, { folder: 'none', limit: 10 })).toHaveLength(
      1,
    );
    expect(await methods.listLibraryDocuments(userA, { folder: 'not-an-id', limit: 10 })).toEqual(
      [],
    );
    expect((await methods.listLibraryFolders(userA))[0].documentCount).toBe(1);
    const out = await methods.updateLibraryDocument(userA, one.document.id, { folderId: null });
    expect(out?.folderId).toBeUndefined();
    expect((await methods.listLibraryFolders(userA))[0].documentCount).toBe(0);
  });

  it("will not file into someone else's folder, or file someone else's document", async () => {
    const theirs = await methods.createLibraryFolder(userB, 'Theirs', 10);
    if (theirs.status === 'limit') throw new Error('limit');
    const mine = await methods.saveLibraryDocument(userA, doc());
    expect(
      await methods.updateLibraryDocument(userA, mine.document.id, { folderId: theirs.folder.id }),
    ).toBeNull();
    expect(
      await methods.updateLibraryDocument(userB, mine.document.id, { folderId: theirs.folder.id }),
    ).toBeNull();
    expect((await methods.getLibraryDocument(userA, mine.document.id))?.folderId).toBeUndefined();
  });

  it('renames, refuses a clash, and deleting keeps the documents', async () => {
    const a = await methods.createLibraryFolder(userA, 'A', 10);
    const b = await methods.createLibraryFolder(userA, 'B', 10);
    if (a.status === 'limit' || b.status === 'limit') throw new Error('limit');
    expect(await methods.renameLibraryFolder(userA, a.folder.id, 'b')).toEqual({
      status: 'exists',
    });
    expect(await methods.renameLibraryFolder(userB, a.folder.id, 'Z')).toEqual({
      status: 'not_found',
    });
    expect(await methods.renameLibraryFolder(userA, a.folder.id, 'A2')).toMatchObject({
      status: 'renamed',
    });
    const d = await methods.saveLibraryDocument(userA, doc());
    await methods.updateLibraryDocument(userA, d.document.id, { folderId: a.folder.id });
    expect(await methods.deleteLibraryFolder(userB, a.folder.id)).toBe(false);
    expect(await methods.deleteLibraryFolder(userA, a.folder.id)).toBe(true);
    const after = await methods.getLibraryDocument(userA, d.document.id);
    expect(after).not.toBeNull();
    expect(after?.folderId).toBeUndefined();
    expect(await methods.deleteAllLibraryData(userA)).toMatchObject({ folders: 1 });
  });
});

describe('OCR text for a scanned page', () => {
  const scanned = (over: Partial<LibraryBookInput> = {}) =>
    book({
      kind: 'pdf',
      urlKey: 'upload://scan',
      needsOcr: true,
      text: '',
      units: [0, 1, 2, 3, 4, 5].map((index) => ({
        index,
        kind: 'page' as const,
        contentHtml: '',
        text: index === 5 ? 'Real text here ok.' : '',
        wordCount: index === 5 ? 4 : 0,
        contentHash: HASH,
      })),
      ...over,
    });
  const ocr = (text: string) => ({ text, contentHash: HASH2, wordCount: text.split(' ').length });

  it('fills blank pages, refreshes the document, and clears needsOcr once there is enough text', async () => {
    const saved = await methods.saveLibraryBook(userA, scanned());
    const id = saved.document.id;
    const page = 'hello scanned world';
    const first = await methods.saveLibraryUnitText(userA, id, 0, ocr(page), 10);
    expect(first).toMatchObject({ status: 'saved', needsOcr: true });
    if (first.status !== 'saved') throw new Error('not saved');
    expect(first.unit).toMatchObject({ index: 0, text: page, contentHash: HASH2 });
    expect(await methods.saveLibraryUnitText(userA, id, 1, ocr(page), 10)).toMatchObject({
      needsOcr: true,
    });
    expect(await methods.saveLibraryUnitText(userA, id, 2, ocr(page), 10)).toMatchObject({
      needsOcr: false,
    });
    const doc = await methods.getLibraryDocument(userA, id);
    expect(doc).toMatchObject({ needsOcr: false, wordCount: 3 * 3 + 4 });
    expect(doc?.text).toContain(page);
    expect(doc?.contentHash).toBe(HASH);
    expect(await methods.searchLibraryDocuments(userA, 'scanned', 10)).toHaveLength(1);
  });

  it("never replaces a page that already has text, or touches someone else's", async () => {
    const saved = await methods.saveLibraryBook(userA, scanned());
    const id = saved.document.id;
    expect(await methods.saveLibraryUnitText(userA, id, 5, ocr('overwrite'), 10)).toEqual({
      status: 'has_text',
    });
    expect((await methods.getLibraryUnit(userA, id, 5))?.text).toContain('Real text');
    expect(await methods.saveLibraryUnitText(userB, id, 0, ocr('theirs'), 10)).toEqual({
      status: 'not_found',
    });
    expect(await methods.saveLibraryUnitText(userA, id, 9, ocr('missing'), 10)).toEqual({
      status: 'not_found',
    });
    const article = await methods.saveLibraryDocument(userA, doc());
    expect(await methods.saveLibraryUnitText(userA, article.document.id, 0, ocr('x'), 10)).toEqual({
      status: 'not_found',
    });
  });

  it('lets only one of two racing writes win', async () => {
    const saved = await methods.saveLibraryBook(userA, scanned());
    const results = await Promise.all([
      methods.saveLibraryUnitText(userA, saved.document.id, 0, ocr('first writer'), 10),
      methods.saveLibraryUnitText(userA, saved.document.id, 0, ocr('second writer'), 10),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['has_text', 'saved']);
  });
});

describe('listLibraryDocumentsByIds', () => {
  it("returns only the user's own documents among those asked for, without their text", async () => {
    const a = await methods.saveLibraryDocument(userA, doc({ urlKey: 'x1' }));
    const b = await methods.saveLibraryDocument(userA, doc({ urlKey: 'x2' }));
    const other = await methods.saveLibraryDocument(userB, doc({ urlKey: 'x3' }));
    const found = await methods.listLibraryDocumentsByIds(userA, [
      a.document.id,
      b.document.id,
      other.document.id,
      'not-an-id',
      a.document.id,
    ]);
    expect(found.map((d) => d.id).sort()).toEqual([a.document.id, b.document.id].sort());
    expect(found[0]).not.toHaveProperty('text');
    expect(await methods.listLibraryDocumentsByIds(userA, [])).toEqual([]);
  });
});

describe('daily review', () => {
  const startOfToday = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  };

  const seed = async (count: number) => {
    const { document } = await methods.saveLibraryDocument(userA, doc());
    const made = [];
    for (let i = 0; i < count; i += 1) {
      made.push(
        (await methods.createLibraryHighlight(
          userA,
          highlight(document.id, {
            anchor: { exact: `Quote ${i}`, prefix: '', suffix: '', start: i, end: i + 7 },
          }),
        ))!,
      );
    }
    return made;
  };

  it('offers every highlight once, newest first, until some have been reviewed', async () => {
    const made = await seed(3);
    const listed = await methods.listLibraryReviewHighlights(userA, startOfToday(), 10);
    expect(listed.map((h) => h.id)).toEqual([made[2].id, made[1].id, made[0].id]);
  });

  it('leaves out what was reviewed today, and counts it', async () => {
    const made = await seed(3);
    expect(await methods.markLibraryHighlightReviewed(userA, made[2].id)).toBe(true);

    const listed = await methods.listLibraryReviewHighlights(userA, startOfToday(), 10);
    expect(listed.map((h) => h.id)).toEqual([made[1].id, made[0].id]);
    expect(await methods.countLibraryReviewedSince(userA, startOfToday())).toBe(1);
  });

  it('brings a highlight back on a later day, after those never reviewed', async () => {
    const made = await seed(2);
    await methods.markLibraryHighlightReviewed(userA, made[1].id);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const listed = await methods.listLibraryReviewHighlights(userA, tomorrow, 10);

    expect(listed.map((h) => h.id)).toEqual([made[0].id, made[1].id]);
  });

  it('keeps a muted highlight out for good', async () => {
    const made = await seed(2);
    await methods.markLibraryHighlightReviewed(userA, made[1].id, { mute: true });
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const listed = await methods.listLibraryReviewHighlights(userA, tomorrow, 10);

    expect(listed.map((h) => h.id)).toEqual([made[0].id]);
  });

  it('skips orphaned highlights, honours the limit, and never crosses users', async () => {
    const made = await seed(3);
    await methods.reanchorLibraryHighlights(userA, made[0].documentId, [
      { id: made[0].id, anchor: null, contentHash: HASH },
    ]);

    const listed = await methods.listLibraryReviewHighlights(userA, startOfToday(), 1);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).not.toBe(made[0].id);
    expect(await methods.listLibraryReviewHighlights(userB, startOfToday(), 10)).toEqual([]);
    expect(await methods.markLibraryHighlightReviewed(userB, made[1].id)).toBe(false);
    expect(await methods.markLibraryHighlightReviewed(userA, 'not-an-id')).toBe(false);
    expect(await methods.listLibraryReviewHighlights(userA, startOfToday(), 0)).toEqual([]);
  });
});

describe('the newsletter address', () => {
  const HASH_A = 'c'.repeat(64);
  const HASH_B = 'd'.repeat(64);

  it('belongs to one person and is found by its secret', async () => {
    expect(await methods.getLibraryInbox(userA)).toBeNull();

    const made = await methods.rotateLibraryInbox(userA, HASH_A);

    expect(made.createdAt).toBeInstanceOf(Date);
    expect(await methods.getLibraryInbox(userA)).toEqual(made);
    expect(await methods.findLibraryInboxOwner(HASH_A)).toEqual({ userId: userA });
    expect(await methods.findLibraryInboxOwner(HASH_B)).toBeNull();
    expect(await methods.getLibraryInbox(userB)).toBeNull();
  });

  it('is replaced, not added to, when made again: the old secret stops working', async () => {
    await methods.rotateLibraryInbox(userA, HASH_A);
    await methods.rotateLibraryInbox(userA, HASH_B);

    expect(await methods.findLibraryInboxOwner(HASH_A)).toBeNull();
    expect(await methods.findLibraryInboxOwner(HASH_B)).toEqual({ userId: userA });
    expect(await mongoose.models.LibraryInbox.countDocuments({})).toBe(1);
  });

  it('can be turned off, and goes with the rest of a person’s library data', async () => {
    await methods.rotateLibraryInbox(userA, HASH_A);
    expect(await methods.deleteLibraryInbox(userA)).toBe(true);
    expect(await methods.deleteLibraryInbox(userA)).toBe(false);
    expect(await methods.findLibraryInboxOwner(HASH_A)).toBeNull();

    await methods.rotateLibraryInbox(userB, HASH_B);
    expect(await methods.deleteAllLibraryData(userB)).toMatchObject({ inboxes: 1 });
    expect(await methods.getLibraryInbox(userB)).toBeNull();
  });
});

describe('listing: excerpt, kind and sort', () => {
  it('keeps the opening of the text as an excerpt, cut at a word', async () => {
    const long = `${'word '.repeat(80)}end`;
    const saved = await methods.saveLibraryDocument(userA, doc({ text: long }));
    const [listed] = await methods.listLibraryDocuments(userA, { limit: 10 });
    expect(listed.id).toBe(saved.document.id);
    expect(listed.excerpt?.endsWith('word…')).toBe(true);
    expect(listed.excerpt?.length).toBeLessThanOrEqual(201);
  });

  it('filters by kind and sorts by title or length', async () => {
    await methods.saveLibraryDocument(
      userA,
      doc({ urlKey: 'k1', title: 'Bravo', readingMinutes: 9 }),
    );
    await methods.saveLibraryDocument(
      userA,
      doc({ urlKey: 'k2', title: 'Alpha', readingMinutes: 2 }),
    );
    await methods.saveLibraryDocument(
      userA,
      doc({ urlKey: 'k3', title: 'Charlie', kind: 'pdf', readingMinutes: 5 }),
    );
    const titles = async (query: Partial<Parameters<typeof methods.listLibraryDocuments>[1]>) =>
      (await methods.listLibraryDocuments(userA, { limit: 10, ...query })).map((d) => d.title);
    expect(await titles({ sort: 'title' })).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(await titles({ sort: 'shortest' })).toEqual(['Alpha', 'Charlie', 'Bravo']);
    expect(await titles({ sort: 'longest' })).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect(await titles({ kind: 'pdf' })).toEqual(['Charlie']);
  });
});

describe('thumbnails', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it('keeps one picture for an article and lists its path', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc());
    expect(
      await methods.setLibraryThumbnail(userA, saved.document.id, {
        mediaType: 'image/png',
        bytes: png,
      }),
    ).toBe(true);
    const [listed] = await methods.listLibraryDocuments(userA, { limit: 10 });
    expect(listed.thumbnailPath).toBe('__thumbnail__');
    const image = await methods.getLibraryResource(userA, saved.document.id, '__thumbnail__');
    expect([...(image?.bytes ?? [])]).toEqual([...png]);
  });

  it('replaces the picture rather than adding another', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc());
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    await methods.setLibraryThumbnail(userA, saved.document.id, {
      mediaType: 'image/png',
      bytes: png,
    });
    await methods.setLibraryThumbnail(userA, saved.document.id, {
      mediaType: 'image/jpeg',
      bytes: jpeg,
    });
    const image = await methods.getLibraryResource(userA, saved.document.id, '__thumbnail__');
    expect(image?.mediaType).toBe('image/jpeg');
  });

  it('refuses a document that belongs to someone else', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc());
    expect(
      await methods.setLibraryThumbnail(userB, saved.document.id, {
        mediaType: 'image/png',
        bytes: png,
      }),
    ).toBe(false);
    expect(await methods.getLibraryResource(userB, saved.document.id, '__thumbnail__')).toBeNull();
  });
});

describe('pinned views', () => {
  const filter = { location: 'later' as const, kind: 'pdf' as const, sort: 'shortest' as const };

  it('keeps a name and its filters, and lists them in the order they were made', async () => {
    const first = await methods.createLibraryView(userA, ' Short  reads ', filter, 20);
    await methods.createLibraryView(userA, 'Papers', { kind: 'pdf', tag: 'paper' }, 20);
    expect(first.status).toBe('created');
    const views = await methods.listLibraryViews(userA);
    expect(views.map((v) => v.name)).toEqual(['Short reads', 'Papers']);
    expect(views[0].filter).toEqual(filter);
    expect(views[1].filter).toEqual({ kind: 'pdf', tag: 'paper' });
  });

  it('returns the view that already has the name, ignoring case', async () => {
    await methods.createLibraryView(userA, 'Shortlist', filter, 20);
    const again = await methods.createLibraryView(userA, 'shortlist', { kind: 'epub' }, 20);
    expect(again.status).toBe('exists');
    expect(await methods.listLibraryViews(userA)).toHaveLength(1);
  });

  it('stops at the limit', async () => {
    await methods.createLibraryView(userA, 'One', {}, 2);
    await methods.createLibraryView(userA, 'Two', {}, 2);
    expect((await methods.createLibraryView(userA, 'Three', {}, 2)).status).toBe('limit');
  });

  it('renames a view, but not onto another one', async () => {
    const one = await methods.createLibraryView(userA, 'One', {}, 20);
    await methods.createLibraryView(userA, 'Two', {}, 20);
    if (one.status === 'limit') throw new Error('unexpected');
    expect((await methods.renameLibraryView(userA, one.view.id, 'Two')).status).toBe('exists');
    const renamed = await methods.renameLibraryView(userA, one.view.id, 'Uno');
    expect(renamed.status).toBe('renamed');
    expect((await methods.listLibraryViews(userA)).map((v) => v.name)).toEqual(['Uno', 'Two']);
  });

  it('keeps views apart between users', async () => {
    const mine = await methods.createLibraryView(userA, 'Mine', {}, 20);
    if (mine.status === 'limit') throw new Error('unexpected');
    expect(await methods.listLibraryViews(userB)).toEqual([]);
    expect((await methods.renameLibraryView(userB, mine.view.id, 'Stolen')).status).toBe(
      'not_found',
    );
    expect(await methods.deleteLibraryView(userB, mine.view.id)).toBe(false);
    expect(await methods.deleteLibraryView(userA, mine.view.id)).toBe(true);
  });

  it('drops the views of a folder when the folder is deleted', async () => {
    const folder = await methods.createLibraryFolder(userA, 'Psychology', 50);
    if (folder.status === 'limit') throw new Error('unexpected');
    await methods.createLibraryView(userA, 'In folder', { folder: folder.folder.id }, 20);
    await methods.createLibraryView(userA, 'Elsewhere', { folder: 'none' }, 20);
    await methods.deleteLibraryFolder(userA, folder.folder.id);
    expect((await methods.listLibraryViews(userA)).map((v) => v.name)).toEqual(['Elsewhere']);
  });

  it('is removed with everything else a person saved', async () => {
    await methods.createLibraryView(userA, 'Mine', {}, 20);
    const deleted = await methods.deleteAllLibraryData(userA);
    expect(deleted.views).toBe(1);
    expect(await methods.listLibraryViews(userA)).toEqual([]);
  });
});

describe('editing a document', () => {
  it('keeps a note and a summary, and removes them when emptied', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc());
    const id = saved.document.id;
    const updated = await methods.updateLibraryDocument(userA, id, {
      note: 'Check the sources',
      summary: 'Memory fades.',
    });
    expect(updated?.note).toBe('Check the sources');
    expect(updated?.summary).toBe('Memory fades.');
    const cleared = await methods.updateLibraryDocument(userA, id, { note: '', summary: '' });
    expect(cleared?.note).toBeUndefined();
    expect(cleared?.summary).toBeUndefined();
  });

  it('keeps an edited title and author when the same page is saved again', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc({ byline: 'Original Author' }));
    await methods.updateLibraryDocument(userA, saved.document.id, {
      title: 'My title',
      byline: 'Me',
    });
    await methods.saveLibraryDocument(
      userA,
      doc({
        title: 'Page title changed',
        byline: 'Someone else',
        text: 'Memory decays on a curve.',
      }),
    );
    const read = await methods.getLibraryDocument(userA, saved.document.id);
    expect(read?.title).toBe('My title');
    expect(read?.byline).toBe('Me');
  });

  it('takes the author off with an empty value, and still keeps that on a re-save', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc({ byline: 'Original Author' }));
    const cleared = await methods.updateLibraryDocument(userA, saved.document.id, { byline: null });
    expect(cleared?.byline).toBeUndefined();
    await methods.saveLibraryDocument(userA, doc({ byline: 'Original Author' }));
    expect((await methods.getLibraryDocument(userA, saved.document.id))?.byline).toBeUndefined();
  });

  it('puts back the page’s own title and author, after more than one edit', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc({ byline: 'Original Author' }));
    const id = saved.document.id;
    const first = await methods.updateLibraryDocument(userA, id, { title: 'Mine', byline: 'Me' });
    expect(first?.metaEdited).toBe(true);
    // A second edit must not replace what the page itself said with the first edit.
    await methods.updateLibraryDocument(userA, id, { title: 'Mine again' });

    const restored = await methods.updateLibraryDocument(userA, id, { restoreMeta: true });
    expect(restored?.title).toBe(doc().title);
    expect(restored?.byline).toBe('Original Author');
    expect(restored?.metaEdited).toBeUndefined();

    // After a restore the document follows the page again.
    await methods.saveLibraryDocument(userA, doc({ title: 'Page renamed' }));
    expect((await methods.getLibraryDocument(userA, id))?.title).toBe('Page renamed');
  });

  it('puts back the page’s newer title when the page changed after the edit', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc({ byline: 'Original Author' }));
    const id = saved.document.id;
    await methods.updateLibraryDocument(userA, id, { title: 'Mine', byline: null });
    await methods.saveLibraryDocument(
      userA,
      doc({ title: 'Page renamed', byline: 'New Author', text: 'Memory decays on a curve.' }),
    );
    expect((await methods.getLibraryDocument(userA, id))?.title).toBe('Mine');

    const restored = await methods.updateLibraryDocument(userA, id, { restoreMeta: true });
    expect(restored?.title).toBe('Page renamed');
    expect(restored?.byline).toBe('New Author');
  });

  it('takes the author off again when the page had none', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc());
    const id = saved.document.id;
    await methods.updateLibraryDocument(userA, id, { byline: 'Me' });
    const restored = await methods.updateLibraryDocument(userA, id, { restoreMeta: true });
    expect(restored?.byline).toBeUndefined();
  });

  it('has nothing to put back for a title that was never edited, and not for another person', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc());
    const same = await methods.updateLibraryDocument(userA, saved.document.id, {
      restoreMeta: true,
    });
    expect(same?.title).toBe(doc().title);
    expect(same?.metaEdited).toBeUndefined();
    expect(
      await methods.updateLibraryDocument(userB, saved.document.id, { restoreMeta: true }),
    ).toBeNull();
  });

  it('lets a page that was never edited follow the page', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc({ title: 'First' }));
    await methods.saveLibraryDocument(userA, doc({ title: 'Second' }));
    expect((await methods.getLibraryDocument(userA, saved.document.id))?.title).toBe('Second');
  });

  it('does not touch another person’s document', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc());
    expect(await methods.updateLibraryDocument(userB, saved.document.id, { note: 'x' })).toBeNull();
  });
});

describe('counting documents', () => {
  it('counts only the person’s own', async () => {
    await methods.saveLibraryDocument(userA, doc({ urlKey: 'c1' }));
    await methods.saveLibraryDocument(userA, doc({ urlKey: 'c2' }));
    await methods.saveLibraryDocument(userB, doc({ urlKey: 'c3' }));
    expect(await methods.countLibraryDocuments(userA)).toBe(2);
    expect(await methods.countLibraryDocuments(userB)).toBe(1);
    expect(await methods.countLibraryDocuments(new mongoose.Types.ObjectId().toString())).toBe(0);
  });
});

describe('public links', () => {
  it('makes one link per document and keeps its token when what it shows changes', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc());
    const id = saved.document.id;
    expect(await methods.getLibraryShare(userA, id)).toBeNull();

    const first = await methods.upsertLibraryShare(userA, id, { includeHighlights: false });
    expect(first?.includeHighlights).toBe(false);
    expect(first?.token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const changed = await methods.upsertLibraryShare(userA, id, { includeHighlights: true });
    expect(changed?.token).toBe(first?.token);
    expect(changed?.includeHighlights).toBe(true);
    expect((await methods.getLibraryShare(userA, id))?.token).toBe(first?.token);
    expect(await mongoose.models.LibraryShare.countDocuments({})).toBe(1);
  });

  it('gives each document its own token', async () => {
    const a = await methods.saveLibraryDocument(userA, doc({ urlKey: 'a' }));
    const b = await methods.saveLibraryDocument(userA, doc({ urlKey: 'b' }));
    const one = await methods.upsertLibraryShare(userA, a.document.id, {
      includeHighlights: false,
    });
    const two = await methods.upsertLibraryShare(userA, b.document.id, {
      includeHighlights: false,
    });
    expect(one?.token).not.toBe(two?.token);
  });

  it('finds what a token points at, and nothing for a token that is wrong or too short', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc());
    const share = await methods.upsertLibraryShare(userA, saved.document.id, {
      includeHighlights: true,
    });
    expect(await methods.findLibraryShareByToken(share?.token ?? '')).toEqual({
      userId: userA,
      documentId: saved.document.id,
      includeHighlights: true,
    });
    expect(await methods.findLibraryShareByToken('x'.repeat(22))).toBeNull();
    expect(await methods.findLibraryShareByToken('short')).toBeNull();
    expect(await methods.findLibraryShareByToken('')).toBeNull();
    expect(await methods.findLibraryShareByToken({ $ne: '' } as unknown as string)).toBeNull();
  });

  it('withdraws a link, which then points at nothing', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc());
    const share = await methods.upsertLibraryShare(userA, saved.document.id, {
      includeHighlights: false,
    });
    expect(await methods.deleteLibraryShare(userA, saved.document.id)).toBe(true);
    expect(await methods.deleteLibraryShare(userA, saved.document.id)).toBe(false);
    expect(await methods.findLibraryShareByToken(share?.token ?? '')).toBeNull();
  });

  it('is the owner’s alone to make, read or withdraw', async () => {
    const saved = await methods.saveLibraryDocument(userA, doc());
    const id = saved.document.id;
    expect(await methods.upsertLibraryShare(userB, id, { includeHighlights: false })).toBeNull();
    const share = await methods.upsertLibraryShare(userA, id, { includeHighlights: false });
    expect(await methods.getLibraryShare(userB, id)).toBeNull();
    expect(await methods.deleteLibraryShare(userB, id)).toBe(false);
    expect(await methods.findLibraryShareByToken(share?.token ?? '')).not.toBeNull();
    expect(
      await methods.upsertLibraryShare(userA, 'nope', { includeHighlights: false }),
    ).toBeNull();
  });

  it('goes away with the document, and with everything a person has', async () => {
    const a = await methods.saveLibraryDocument(userA, doc({ urlKey: 'a' }));
    const b = await methods.saveLibraryDocument(userA, doc({ urlKey: 'b' }));
    const gone = await methods.upsertLibraryShare(userA, a.document.id, {
      includeHighlights: false,
    });
    const kept = await methods.upsertLibraryShare(userA, b.document.id, {
      includeHighlights: false,
    });

    await methods.deleteLibraryDocument(userA, a.document.id);
    expect(await methods.findLibraryShareByToken(gone?.token ?? '')).toBeNull();
    expect(await methods.findLibraryShareByToken(kept?.token ?? '')).not.toBeNull();

    expect(await methods.deleteAllLibraryData(userA)).toMatchObject({ shares: 1 });
    expect(await methods.findLibraryShareByToken(kept?.token ?? '')).toBeNull();
  });
});
