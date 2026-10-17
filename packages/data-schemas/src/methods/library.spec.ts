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
  if (!mongoose.models.LibrarySource) {
    mongoose.model('LibrarySource', librarySourceSchema);
  }
  if (!mongoose.models.LibraryFeed) {
    mongoose.model('LibraryFeed', libraryFeedSchema);
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
