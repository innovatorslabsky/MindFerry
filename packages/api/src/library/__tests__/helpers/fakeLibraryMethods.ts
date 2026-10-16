import type {
  LibraryBookInput,
  LibraryDocumentInput,
  LibraryDocumentRecord,
  LibraryFeedState,
  LibraryHighlightRecord,
  LibraryMethods,
  LibraryProgressRecord,
  LibraryResourceRecord,
  LibraryUnitRecord,
} from '@librechat/data-schemas';

/** In-memory stand-in for the data-schemas library methods, keyed by user so isolation is testable. */
export function createFakeLibraryMethods() {
  let counter = 0;
  const nextId = () => `id${++counter}`;
  const documents = new Map<string, LibraryDocumentRecord & { userId: string }>();
  const highlights = new Map<string, LibraryHighlightRecord & { userId: string }>();
  const progress = new Map<string, LibraryProgressRecord & { userId: string }>();
  const units = new Map<string, LibraryUnitRecord & { userId: string }>();
  const resources = new Map<string, LibraryResourceRecord & { userId: string }>();
  const feeds = new Map<string, LibraryFeedState & { userId: string }>();

  const methods: LibraryMethods = {
    async saveLibraryDocument(userId, input: LibraryDocumentInput) {
      const existing = [...documents.values()].find(
        (d) => d.userId === userId && d.urlKey === input.urlKey,
      );
      const now = new Date();
      if (existing) {
        const contentChanged = existing.contentHash !== input.contentHash;
        const { location: _ignored, ...content } = input;
        Object.assign(existing, content, { updatedAt: now });
        return { document: { ...existing }, created: false, contentChanged };
      }
      const document = {
        ...input,
        userId,
        id: nextId(),
        kind: input.kind ?? 'article',
        unitCount: input.unitCount ?? 0,
        toc: input.toc ?? [],
        location: input.location ?? 'inbox',
        tags: [],
        createdAt: now,
        updatedAt: now,
      } as LibraryDocumentRecord & { userId: string };
      documents.set(document.id, document);
      return { document: { ...document }, created: true, contentChanged: false };
    },
    async saveLibraryBook(userId, input: LibraryBookInput) {
      const { units: incoming, resources: images = [], ...rest } = input;
      const saved = await methods.saveLibraryDocument(userId, {
        ...rest,
        unitCount: incoming.length,
      });
      if (saved.created || saved.contentChanged) {
        for (const key of [...units.keys()]) {
          if (key.startsWith(`${saved.document.id}:`)) units.delete(key);
        }
        for (const key of [...resources.keys()]) {
          if (key.startsWith(`${saved.document.id}:`)) resources.delete(key);
        }
        for (const image of images) {
          resources.set(`${saved.document.id}:${image.path}`, {
            path: image.path,
            mediaType: image.mediaType,
            bytes: Buffer.from(image.bytes),
            userId,
          });
        }
        for (const unit of incoming) {
          units.set(`${saved.document.id}:${unit.index}`, {
            ...unit,
            userId,
            documentId: saved.document.id,
            contentHtml: unit.contentHtml ?? '',
          });
        }
      }
      return saved;
    },
    async getLibraryResource(userId, documentId, path) {
      const found = resources.get(`${documentId}:${path}`);
      return found && found.userId === userId
        ? { path: found.path, mediaType: found.mediaType, bytes: found.bytes }
        : null;
    },
    async listLibraryUnits(userId, documentId) {
      return [...units.values()]
        .filter((u) => u.userId === userId && u.documentId === documentId)
        .sort((a, b) => a.index - b.index)
        .map(({ index, kind, title, wordCount, contentHash }) => ({
          index,
          kind,
          title,
          wordCount,
          contentHash,
        }));
    },
    async getLibraryUnit(userId, documentId, index) {
      const unit = units.get(`${documentId}:${index}`);
      return unit && unit.userId === userId ? { ...unit } : null;
    },
    async getLibraryDocument(userId, id) {
      const doc = documents.get(id);
      return doc && doc.userId === userId ? { ...doc } : null;
    },
    async listLibraryDocuments(userId, query) {
      return [...documents.values()]
        .filter(
          (d) =>
            d.userId === userId &&
            (!query.location || d.location === query.location) &&
            (!query.tag || d.tags.includes(query.tag)),
        )
        .slice(0, query.limit);
    },
    async searchLibraryDocuments(userId, query, limit) {
      return [...documents.values()]
        .filter((d) => d.userId === userId && d.text.includes(query))
        .slice(0, limit);
    },
    async updateLibraryDocument(userId, id, patch) {
      const doc = documents.get(id);
      if (!doc || doc.userId !== userId) return null;
      Object.assign(doc, patch);
      return { ...doc };
    },
    async deleteLibraryDocument(userId, id) {
      const doc = documents.get(id);
      if (!doc || doc.userId !== userId) return false;
      documents.delete(id);
      return true;
    },
    async createLibraryHighlight(userId, input) {
      const doc = documents.get(input.documentId);
      if (!doc || doc.userId !== userId) return null;
      const now = new Date();
      const highlight = {
        id: nextId(),
        userId,
        documentId: input.documentId,
        anchor: input.anchor,
        color: input.color ?? 'yellow',
        note: input.note,
        tags: input.tags ?? [],
        unit: input.unit,
        contentHash: input.contentHash,
        orphaned: false,
        createdAt: now,
        updatedAt: now,
      } as LibraryHighlightRecord & { userId: string };
      highlights.set(highlight.id, highlight);
      return { ...highlight };
    },
    async listLibraryHighlights(userId, documentId) {
      return [...highlights.values()].filter(
        (h) => h.userId === userId && (!documentId || h.documentId === documentId),
      );
    },
    async updateLibraryHighlight(userId, id, patch) {
      const h = highlights.get(id);
      if (!h || h.userId !== userId) return null;
      const { note, ...rest } = patch;
      Object.assign(h, rest);
      if (note === null) delete h.note;
      else if (note !== undefined) h.note = note;
      return { ...h };
    },
    async deleteLibraryHighlight(userId, id) {
      const h = highlights.get(id);
      if (!h || h.userId !== userId) return false;
      highlights.delete(id);
      return true;
    },
    async reanchorLibraryHighlights(userId, documentId, results) {
      let modified = 0;
      for (const result of results) {
        const h = highlights.get(result.id);
        if (!h || h.userId !== userId || h.documentId !== documentId) continue;
        if (result.anchor) {
          h.anchor = result.anchor;
          h.orphaned = false;
          h.contentHash = result.contentHash;
        } else {
          h.orphaned = true;
        }
        modified++;
      }
      return modified;
    },
    async getLibraryProgress(userId, documentId) {
      const p = progress.get(`${userId}:${documentId}`);
      return p ? { ...p } : null;
    },
    async setLibraryProgress(userId, documentId, textOffset, contentHash, unitIndex) {
      const doc = documents.get(documentId);
      if (!doc || doc.userId !== userId) return null;
      const record = {
        userId,
        documentId,
        textOffset,
        contentHash,
        ...(unitIndex === undefined ? {} : { unitIndex }),
        updatedAt: new Date(),
      };
      progress.set(`${userId}:${documentId}`, record);
      return { ...record };
    },
    async addLibraryFeed(userId, input, maxFeeds) {
      const mine = [...feeds.values()].filter((f) => f.userId === userId);
      const existing = mine.find((f) => f.feedUrl === input.feedUrl);
      if (existing) return { status: 'exists', feed: { ...existing } };
      if (mine.length >= maxFeeds) return { status: 'limit' };
      const feed = { ...input, userId, id: nextId(), seenKeys: [], createdAt: new Date() };
      feeds.set(feed.id, feed);
      return { status: 'added', feed: { ...feed } };
    },
    async listLibraryFeeds(userId) {
      return [...feeds.values()].filter((f) => f.userId === userId).map((f) => ({ ...f }));
    },
    async getLibraryFeed(userId, id) {
      const feed = feeds.get(id);
      return feed && feed.userId === userId ? { ...feed, seenKeys: [...feed.seenKeys] } : null;
    },
    async recordLibraryFeedRefresh(userId, id, refresh) {
      const feed = feeds.get(id);
      if (!feed || feed.userId !== userId) return false;
      if (refresh.title) feed.title = refresh.title;
      if (refresh.etag !== undefined) feed.etag = refresh.etag ?? undefined;
      if (refresh.lastModified !== undefined) feed.lastModified = refresh.lastModified ?? undefined;
      feed.seenKeys.push(...refresh.newKeys);
      feed.lastRefreshedAt = new Date();
      return true;
    },
    async deleteLibraryFeed(userId, id) {
      const feed = feeds.get(id);
      if (!feed || feed.userId !== userId) return false;
      feeds.delete(id);
      return true;
    },
    async deleteAllLibraryData() {
      return { documents: 0, highlights: 0, progress: 0, units: 0, resources: 0, feeds: 0 };
    },
  };
  return { methods, documents, highlights, progress, feeds };
}
