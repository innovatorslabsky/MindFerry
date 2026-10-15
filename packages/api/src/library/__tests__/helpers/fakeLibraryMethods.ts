import type {
  LibraryDocumentInput,
  LibraryDocumentRecord,
  LibraryHighlightRecord,
  LibraryMethods,
  LibraryProgressRecord,
} from '@librechat/data-schemas';

/** In-memory stand-in for the data-schemas library methods, keyed by user so isolation is testable. */
export function createFakeLibraryMethods() {
  let counter = 0;
  const nextId = () => `id${++counter}`;
  const documents = new Map<string, LibraryDocumentRecord & { userId: string }>();
  const highlights = new Map<string, LibraryHighlightRecord & { userId: string }>();
  const progress = new Map<string, LibraryProgressRecord & { userId: string }>();

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
        location: input.location ?? 'inbox',
        tags: [],
        createdAt: now,
        updatedAt: now,
      } as LibraryDocumentRecord & { userId: string };
      documents.set(document.id, document);
      return { document: { ...document }, created: true, contentChanged: false };
    },
    async getLibraryDocument(userId, id) {
      const doc = documents.get(id);
      return doc && doc.userId === userId ? { ...doc } : null;
    },
    async listLibraryDocuments(userId, query) {
      return [...documents.values()]
        .filter((d) => d.userId === userId && (!query.location || d.location === query.location))
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
    async setLibraryProgress(userId, documentId, textOffset, contentHash) {
      const doc = documents.get(documentId);
      if (!doc || doc.userId !== userId) return null;
      const record = { userId, documentId, textOffset, contentHash, updatedAt: new Date() };
      progress.set(`${userId}:${documentId}`, record);
      return { ...record };
    },
    async deleteAllLibraryData() {
      return { documents: 0, highlights: 0, progress: 0 };
    },
  };
  return { methods, documents, highlights, progress };
}
