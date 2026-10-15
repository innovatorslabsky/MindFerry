import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { LibraryDocumentInput, LibraryHighlightInput } from '~/types';
import libraryDocumentSchema from '~/schema/libraryDocument';
import libraryHighlightSchema from '~/schema/libraryHighlight';
import libraryProgressSchema from '~/schema/libraryProgress';
import { createLibraryMethods, type LibraryMethods } from './library';

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
    });
    expect(await methods.listLibraryDocuments(userB, { limit: 10 })).toHaveLength(1);
    expect(await methods.listLibraryHighlights(userB)).toHaveLength(1);
  });
});
