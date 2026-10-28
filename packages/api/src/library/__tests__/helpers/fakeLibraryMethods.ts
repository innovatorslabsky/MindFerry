import type {
  LibraryBookInput,
  LibraryDocumentInput,
  LibraryDocumentRecord,
  LibraryFeedState,
  LibraryFolderRecord,
  LibraryHighlightRecord,
  LibraryMethods,
  LibraryProgressRecord,
  LibraryResourceRecord,
  LibraryUnitRecord,
  LibraryViewRecord,
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
  const sources = new Map<string, Uint8Array>();
  const reviews = new Map<string, { reviewedAt: Date; muted: boolean }>();
  const inboxes = new Map<string, { tokenHash: string; createdAt: Date }>();
  const shares = new Map<
    string,
    { documentId: string; token: string; includeHighlights: boolean; createdAt: Date }
  >();
  const folders = new Map<string, LibraryFolderRecord & { userId: string }>();
  const views = new Map<string, LibraryViewRecord & { userId: string }>();
  const feeds = new Map<string, LibraryFeedState & { userId: string }>();

  const methods: LibraryMethods = {
    async saveLibraryDocument(userId, input: LibraryDocumentInput) {
      const existing = [...documents.values()].find(
        (d) => d.userId === userId && d.urlKey === input.urlKey,
      );
      const now = new Date();
      if (existing) {
        const contentChanged = existing.contentHash !== input.contentHash;
        const { location: _ignored, tags: _tags, ...content } = input;
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
        tags: input.tags ?? [],
        hasSource: false,
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
    async setLibraryThumbnail(userId, documentId, image) {
      const document = documents.get(documentId);
      if (!document || document.userId !== userId) return false;
      resources.set(`${documentId}:__thumbnail__`, {
        path: '__thumbnail__',
        mediaType: image.mediaType,
        bytes: Buffer.from(image.bytes),
        userId,
      });
      document.thumbnailPath = '__thumbnail__';
      return true;
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
    async listLibraryDocumentsByIds(userId, ids) {
      return ids
        .map((id) => documents.get(id))
        .filter(
          (d, i, all): d is NonNullable<typeof d> =>
            !!d && d.userId === userId && all.indexOf(d) === i,
        )
        .map(({ text: _text, contentHtml: _html, ...summary }) => ({ ...summary }));
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
            (!query.tag || d.tags.includes(query.tag)) &&
            (!query.folder ||
              (query.folder === 'none' ? !d.folderId : d.folderId === query.folder)),
        )
        .slice(0, query.limit);
    },
    async countLibraryDocuments(userId) {
      return [...documents.values()].filter((d) => d.userId === userId).length;
    },
    async searchLibraryDocuments(userId, query, limit) {
      return [...documents.values()]
        .filter((d) => d.userId === userId && d.text.includes(query))
        .slice(0, limit);
    },
    async updateLibraryDocument(userId, id, patch) {
      const doc = documents.get(id);
      if (!doc || doc.userId !== userId) return null;
      const { folderId, ...rest } = patch;
      if (typeof folderId === 'string') {
        const folder = folders.get(folderId);
        if (!folder || folder.userId !== userId) return null;
        doc.folderId = folderId;
      } else if (folderId === null) {
        delete doc.folderId;
      }
      Object.assign(doc, rest);
      for (const field of ['byline', 'note', 'summary'] as const) {
        if (field in patch && !doc[field]) delete doc[field];
      }
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
    async rotateLibraryInbox(userId, tokenHash) {
      const createdAt = new Date();
      inboxes.set(userId, { tokenHash, createdAt });
      return { createdAt };
    },
    async getLibraryInbox(userId) {
      const inbox = inboxes.get(userId);
      return inbox ? { createdAt: inbox.createdAt } : null;
    },
    async deleteLibraryInbox(userId) {
      return inboxes.delete(userId);
    },
    async findLibraryInboxOwner(tokenHash) {
      for (const [userId, inbox] of inboxes) {
        if (inbox.tokenHash === tokenHash) return { userId };
      }
      return null;
    },
    async getLibraryShare(userId, documentId) {
      const share = shares.get(`${userId}:${documentId}`);
      return share
        ? {
            token: share.token,
            includeHighlights: share.includeHighlights,
            createdAt: share.createdAt,
          }
        : null;
    },
    async upsertLibraryShare(userId, documentId, options) {
      if (documents.get(documentId)?.userId !== userId) return null;
      const key = `${userId}:${documentId}`;
      const share = shares.get(key) ?? {
        documentId,
        token: `tok${shares.size}`.padEnd(22, 'x'),
        includeHighlights: false,
        createdAt: new Date(),
      };
      share.includeHighlights = options.includeHighlights;
      shares.set(key, share);
      return {
        token: share.token,
        includeHighlights: share.includeHighlights,
        createdAt: share.createdAt,
      };
    },
    async deleteLibraryShare(userId, documentId) {
      return shares.delete(`${userId}:${documentId}`);
    },
    async findLibraryShareByToken(token) {
      for (const [key, share] of shares) {
        if (share.token === token) {
          return {
            userId: key.slice(0, key.indexOf(':')),
            documentId: share.documentId,
            includeHighlights: share.includeHighlights,
          };
        }
      }
      return null;
    },
    async listLibraryReviewHighlights(userId, since, limit) {
      const seen = (h: LibraryHighlightRecord & { userId: string }) =>
        (reviews.get(h.id)?.reviewedAt ?? new Date(0)).getTime();
      return [...highlights.values()]
        .filter(
          (h) =>
            h.userId === userId &&
            !h.orphaned &&
            !reviews.get(h.id)?.muted &&
            (reviews.get(h.id)?.reviewedAt ?? new Date(0)) < since,
        )
        .sort((a, b) => seen(a) - seen(b) || b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, Math.max(limit, 0))
        .map((h) => ({ ...h }));
    },
    async countLibraryReviewedSince(userId, since) {
      return [...highlights.values()].filter(
        (h) => h.userId === userId && (reviews.get(h.id)?.reviewedAt ?? new Date(0)) >= since,
      ).length;
    },
    async markLibraryHighlightReviewed(userId, id, options = {}) {
      const h = highlights.get(id);
      if (!h || h.userId !== userId) return false;
      reviews.set(id, {
        reviewedAt: new Date(),
        muted: options.mute === true || !!reviews.get(id)?.muted,
      });
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
    async saveLibraryUnitText(userId, documentId, index, input, minChars) {
      const doc = documents.get(documentId);
      const unit = units.get(`${documentId}:${index}`);
      if (!doc || doc.userId !== userId || doc.kind !== 'pdf' || !unit)
        return { status: 'not_found' };
      if (unit.text.trim().length >= minChars) return { status: 'has_text' };
      Object.assign(unit, input);
      const all = [...units.values()].filter((u) => u.documentId === documentId);
      const chars = all.reduce((n, u) => n + u.text.trim().length, 0);
      doc.needsOcr = chars / all.length < 10;
      return { status: 'saved', needsOcr: doc.needsOcr, unit: { ...unit } };
    },
    async createLibraryFolder(userId, name, maxFolders) {
      const clean = name.trim().replace(/\s+/g, ' ');
      const mine = [...folders.values()].filter((f) => f.userId === userId);
      const existing = mine.find((f) => f.name.toLowerCase() === clean.toLowerCase());
      const count = (id: string) => [...documents.values()].filter((d) => d.folderId === id).length;
      if (existing)
        return { status: 'exists', folder: { ...existing, documentCount: count(existing.id) } };
      if (mine.length >= maxFolders) return { status: 'limit' };
      const folder = { id: nextId(), userId, name: clean, documentCount: 0, createdAt: new Date() };
      folders.set(folder.id, folder);
      return { status: 'created', folder: { ...folder } };
    },
    async listLibraryFolders(userId) {
      return [...folders.values()]
        .filter((f) => f.userId === userId)
        .map((f) => ({
          ...f,
          documentCount: [...documents.values()].filter((d) => d.folderId === f.id).length,
        }));
    },
    async renameLibraryFolder(userId, id, name) {
      const folder = folders.get(id);
      if (!folder || folder.userId !== userId) return { status: 'not_found' };
      const clean = name.trim().replace(/\s+/g, ' ');
      const clash = [...folders.values()].some(
        (f) => f.userId === userId && f.id !== id && f.name.toLowerCase() === clean.toLowerCase(),
      );
      if (clash) return { status: 'exists' };
      folder.name = clean;
      return { status: 'renamed', folder: { ...folder } };
    },
    async deleteLibraryFolder(userId, id) {
      const folder = folders.get(id);
      if (!folder || folder.userId !== userId) return false;
      folders.delete(id);
      for (const d of documents.values()) if (d.folderId === id) delete d.folderId;
      return true;
    },
    async createLibraryView(userId, name, filter, maxViews) {
      const clean = name.trim().replace(/\s+/g, ' ');
      const mine = [...views.values()].filter((v) => v.userId === userId);
      const existing = mine.find((v) => v.name.toLowerCase() === clean.toLowerCase());
      if (existing) return { status: 'exists', view: { ...existing } };
      if (mine.length >= maxViews) return { status: 'limit' };
      const view = { id: nextId(), userId, name: clean, filter, createdAt: new Date() };
      views.set(view.id, view);
      return { status: 'created', view: { ...view } };
    },
    async listLibraryViews(userId) {
      return [...views.values()].filter((v) => v.userId === userId).map((v) => ({ ...v }));
    },
    async renameLibraryView(userId, id, name) {
      const view = views.get(id);
      if (!view || view.userId !== userId) return { status: 'not_found' };
      const clean = name.trim().replace(/\s+/g, ' ');
      const clash = [...views.values()].some(
        (v) => v.userId === userId && v.id !== id && v.name.toLowerCase() === clean.toLowerCase(),
      );
      if (clash) return { status: 'exists' };
      view.name = clean;
      return { status: 'renamed', view: { ...view } };
    },
    async deleteLibraryView(userId, id) {
      const view = views.get(id);
      if (!view || view.userId !== userId) return false;
      views.delete(id);
      return true;
    },
    async saveLibrarySource(userId, documentId, bytes) {
      const doc = documents.get(documentId);
      if (!doc || doc.userId !== userId || doc.kind !== 'pdf' || bytes.byteLength === 0)
        return false;
      sources.set(documentId, bytes);
      doc.hasSource = true;
      return true;
    },
    async getLibrarySource(userId, documentId) {
      const doc = documents.get(documentId);
      const bytes = sources.get(documentId);
      return doc && doc.userId === userId && bytes ? Buffer.from(bytes) : null;
    },
    async deleteLibrarySource(userId, documentId) {
      const doc = documents.get(documentId);
      if (!doc || doc.userId !== userId || !sources.delete(documentId)) return false;
      doc.hasSource = false;
      return true;
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
      return {
        documents: 0,
        highlights: 0,
        progress: 0,
        units: 0,
        resources: 0,
        sources: 0,
        folders: 0,
        feeds: 0,
        inboxes: 0,
        shares: 0,
        views: 0,
      };
    },
  };
  return { methods, documents, highlights, progress, feeds, sources, folders, views, resources };
}
