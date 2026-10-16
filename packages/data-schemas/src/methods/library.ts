import { Types } from 'mongoose';
import type {
  LibraryAnchorRecord,
  LibraryBookInput,
  LibraryDataDeleteResult,
  LibraryDocumentInput,
  LibraryDocumentPatch,
  LibraryDocumentRecord,
  LibraryDocumentSaveResult,
  LibraryDocumentSummary,
  LibraryFeedAddResult,
  LibraryFeedInput,
  LibraryFeedRecord,
  LibraryFeedRefreshRecord,
  LibraryFeedState,
  LibraryHighlightInput,
  LibraryHighlightPatch,
  LibraryHighlightRecord,
  LibraryListQuery,
  LibraryProgressRecord,
  LibraryReanchor,
  LibraryResourceInput,
  LibraryResourceRecord,
  LibraryUnitRecord,
  LibraryUnitSummary,
} from '~/types';
import type { ILibraryDocument } from '~/schema/libraryDocument';
import type { ILibraryHighlight } from '~/schema/libraryHighlight';
import type { ILibraryProgress } from '~/schema/libraryProgress';
import type { ILibraryUnit } from '~/schema/libraryUnit';
import type { ILibraryResource } from '~/schema/libraryResource';
import type { ILibraryFeed } from '~/schema/libraryFeed';
import type { ILibrarySource } from '~/schema/librarySource';
import { LIBRARY_SOURCE_CHUNK_BYTES } from '~/schema/librarySource';
import { tenantSafeBulkWrite } from '~/utils/tenantBulkWrite';
import logger from '~/config/winston';

export interface LibraryMethods {
  /** Upserts by `urlKey`: saving a page again refreshes its content but keeps its place and tags. */
  saveLibraryDocument: (
    userId: string,
    input: LibraryDocumentInput,
  ) => Promise<LibraryDocumentSaveResult>;
  /**
   * Saves an EPUB or PDF: the document row plus its units. A book whose `urlKey` is already stored
   * has its units replaced only when its content hash changed.
   */
  saveLibraryBook: (userId: string, input: LibraryBookInput) => Promise<LibraryDocumentSaveResult>;
  getLibraryDocument: (userId: string, id: string) => Promise<LibraryDocumentRecord | null>;
  /** One image of a book. `null` when the path is not one of the user's own book's images. */
  getLibraryResource: (
    userId: string,
    documentId: string,
    path: string,
  ) => Promise<LibraryResourceRecord | null>;
  /**
   * Keeps the original file of a PDF the user saved, replacing any earlier copy. `false` when the
   * document is not the user's PDF.
   */
  saveLibrarySource: (userId: string, documentId: string, bytes: Uint8Array) => Promise<boolean>;
  /** The stored original of a PDF. `null` when the user has none for that document. */
  getLibrarySource: (userId: string, documentId: string) => Promise<Buffer | null>;
  /** Drops the stored original, keeping the text and highlights. `false` when there was none. */
  deleteLibrarySource: (userId: string, documentId: string) => Promise<boolean>;
  /** Chapter or page titles and sizes, in order, without their text. */
  listLibraryUnits: (userId: string, documentId: string) => Promise<LibraryUnitSummary[]>;
  getLibraryUnit: (
    userId: string,
    documentId: string,
    index: number,
  ) => Promise<LibraryUnitRecord | null>;
  listLibraryDocuments: (
    userId: string,
    query: LibraryListQuery,
  ) => Promise<LibraryDocumentSummary[]>;
  /** Best text match first. A blank query matches nothing. */
  searchLibraryDocuments: (
    userId: string,
    query: string,
    limit: number,
  ) => Promise<LibraryDocumentSummary[]>;
  updateLibraryDocument: (
    userId: string,
    id: string,
    patch: LibraryDocumentPatch,
  ) => Promise<LibraryDocumentSummary | null>;
  /** Also removes the document's highlights and reading progress. `false` when it is not the user's. */
  deleteLibraryDocument: (userId: string, id: string) => Promise<boolean>;
  /** `null` when the document is not the user's, so a highlight never attaches to someone else's page. */
  createLibraryHighlight: (
    userId: string,
    input: LibraryHighlightInput,
  ) => Promise<LibraryHighlightRecord | null>;
  listLibraryHighlights: (
    userId: string,
    documentId?: string,
    limit?: number,
  ) => Promise<LibraryHighlightRecord[]>;
  updateLibraryHighlight: (
    userId: string,
    id: string,
    patch: LibraryHighlightPatch,
  ) => Promise<LibraryHighlightRecord | null>;
  deleteLibraryHighlight: (userId: string, id: string) => Promise<boolean>;
  /** Applies re-anchoring results in one write; highlights that did not resolve are kept as orphans. */
  reanchorLibraryHighlights: (
    userId: string,
    documentId: string,
    results: LibraryReanchor[],
  ) => Promise<number>;
  getLibraryProgress: (userId: string, documentId: string) => Promise<LibraryProgressRecord | null>;
  setLibraryProgress: (
    userId: string,
    documentId: string,
    textOffset: number,
    contentHash: string,
    unitIndex?: number,
  ) => Promise<LibraryProgressRecord | null>;
  /** Follows a feed. Following one already followed changes nothing; past `maxFeeds` nothing is added. */
  addLibraryFeed: (
    userId: string,
    input: LibraryFeedInput,
    maxFeeds: number,
  ) => Promise<LibraryFeedAddResult>;
  listLibraryFeeds: (userId: string) => Promise<LibraryFeedRecord[]>;
  /** One followed feed with what a refresh needs; `null` when it is not the user's. */
  getLibraryFeed: (userId: string, id: string) => Promise<LibraryFeedState | null>;
  recordLibraryFeedRefresh: (
    userId: string,
    id: string,
    refresh: LibraryFeedRefreshRecord,
  ) => Promise<boolean>;
  deleteLibraryFeed: (userId: string, id: string) => Promise<boolean>;
  deleteAllLibraryData: (userId: string) => Promise<LibraryDataDeleteResult>;
}

const UNIT_INSERT_BATCH = 100;
/** Items remembered per feed. Older keys drop off, so an item old enough to drop is old enough not to return. */
const MAX_SEEN_KEYS = 500;
/** Images are large; a few per write keeps each insert well under the wire-protocol message limit. */
const RESOURCE_INSERT_BATCH = 4;

const SUMMARY_PROJECTION = { contentHtml: 0, text: 0 } as const;

function toObjectId(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

function toSummary(doc: ILibraryDocument): LibraryDocumentSummary {
  return {
    id: (doc._id as Types.ObjectId).toString(),
    urlKey: doc.urlKey,
    normalizedUrl: doc.normalizedUrl,
    kind: doc.kind ?? 'article',
    title: doc.title,
    byline: doc.byline,
    siteName: doc.siteName,
    lang: doc.lang,
    publishedTime: doc.publishedTime,
    contentHash: doc.contentHash,
    wordCount: doc.wordCount,
    readingMinutes: doc.readingMinutes,
    unitCount: doc.unitCount ?? 0,
    toc: (doc.toc ?? []).map((entry) => ({
      title: entry.title,
      depth: entry.depth,
      ...(entry.unitIndex === undefined ? {} : { unitIndex: entry.unitIndex }),
      ...(entry.fragment === undefined ? {} : { fragment: entry.fragment }),
    })),
    ...(doc.needsOcr === undefined ? {} : { needsOcr: doc.needsOcr }),
    ...(doc.truncated === undefined ? {} : { truncated: doc.truncated }),
    hasSource: doc.hasSource === true,
    location: doc.location,
    tags: doc.tags ?? [],
    fetchedAt: doc.fetchedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toDocumentRecord(doc: ILibraryDocument): LibraryDocumentRecord {
  return { ...toSummary(doc), contentHtml: doc.contentHtml, text: doc.text };
}

function toAnchor(anchor: LibraryAnchorRecord): LibraryAnchorRecord {
  return {
    exact: anchor.exact,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
    start: anchor.start,
    end: anchor.end,
  };
}

function toHighlightRecord(doc: ILibraryHighlight): LibraryHighlightRecord {
  return {
    id: (doc._id as Types.ObjectId).toString(),
    documentId: doc.documentId.toString(),
    anchor: toAnchor(doc.anchor),
    color: doc.color,
    note: doc.note,
    tags: doc.tags ?? [],
    ...(doc.unit ? { unit: { kind: doc.unit.kind, index: doc.unit.index } } : {}),
    contentHash: doc.contentHash,
    orphaned: doc.orphaned,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toFeedRecord(doc: ILibraryFeed): LibraryFeedRecord {
  return {
    id: (doc._id as Types.ObjectId).toString(),
    feedUrl: doc.feedUrl,
    title: doc.title,
    ...(doc.siteUrl === undefined ? {} : { siteUrl: doc.siteUrl }),
    ...(doc.lastRefreshedAt === undefined ? {} : { lastRefreshedAt: doc.lastRefreshedAt }),
    createdAt: doc.createdAt,
  };
}

function toFeedState(doc: ILibraryFeed): LibraryFeedState {
  return {
    ...toFeedRecord(doc),
    ...(doc.etag === undefined ? {} : { etag: doc.etag }),
    ...(doc.lastModified === undefined ? {} : { lastModified: doc.lastModified }),
    seenKeys: doc.seenKeys ?? [],
  };
}

function toUnitSummary(doc: ILibraryUnit): LibraryUnitSummary {
  return {
    index: doc.index,
    kind: doc.kind,
    ...(doc.title === undefined ? {} : { title: doc.title }),
    wordCount: doc.wordCount,
    contentHash: doc.contentHash,
  };
}

function toUnitRecord(doc: ILibraryUnit): LibraryUnitRecord {
  return {
    ...toUnitSummary(doc),
    documentId: doc.documentId.toString(),
    contentHtml: doc.contentHtml ?? '',
    text: doc.text ?? '',
  };
}

function toProgressRecord(doc: ILibraryProgress): LibraryProgressRecord {
  return {
    documentId: doc.documentId.toString(),
    ...(doc.unitIndex === undefined || doc.unitIndex === null ? {} : { unitIndex: doc.unitIndex }),
    textOffset: doc.textOffset,
    contentHash: doc.contentHash,
    updatedAt: doc.updatedAt,
  };
}

export function createLibraryMethods(mongoose: typeof import('mongoose')): LibraryMethods {
  async function saveLibraryDocument(
    userId: string,
    input: LibraryDocumentInput,
  ): Promise<LibraryDocumentSaveResult> {
    const LibraryDocument = mongoose.models.LibraryDocument;
    const owner = toObjectId(userId);
    const { location, ...content } = input;
    try {
      const before = (await LibraryDocument.findOne(
        { userId: owner, urlKey: input.urlKey },
        { contentHash: 1 },
      ).lean()) as unknown as Pick<ILibraryDocument, 'contentHash'> | null;
      const saved = (await LibraryDocument.findOneAndUpdate(
        { userId: owner, urlKey: input.urlKey },
        {
          $set: { ...content, userId: owner },
          $setOnInsert: { location: location ?? 'inbox', tags: [] },
        },
        { upsert: true, new: true },
      ).lean()) as unknown as ILibraryDocument;
      return {
        document: toDocumentRecord(saved),
        created: before === null,
        contentChanged: before !== null && before.contentHash !== input.contentHash,
      };
    } catch (error) {
      logger.error('[saveLibraryDocument] Error saving document:', error);
      throw error;
    }
  }

  async function saveLibraryBook(
    userId: string,
    input: LibraryBookInput,
  ): Promise<LibraryDocumentSaveResult> {
    const { units, resources = [], ...documentInput } = input;
    const saved = await saveLibraryDocument(userId, {
      ...documentInput,
      kind: input.kind ?? (units[0]?.kind === 'page' ? 'pdf' : 'epub'),
      unitCount: units.length,
    });
    // Same file, same units: nothing to rewrite. A new or changed book replaces its units whole,
    // so a failed earlier attempt that left only some of them is repaired by the next save.
    const scope = { userId: toObjectId(userId), documentId: toObjectId(saved.document.id) };
    const [storedUnits, storedResources] = await Promise.all([
      mongoose.models.LibraryUnit.countDocuments(scope),
      mongoose.models.LibraryResource.countDocuments(scope),
    ]);
    if (
      saved.created ||
      saved.contentChanged ||
      storedUnits !== units.length ||
      storedResources !== resources.length
    ) {
      await replaceUnits(userId, saved.document.id, units);
      await replaceResources(userId, saved.document.id, resources);
    }
    return saved;
  }

  async function replaceUnits(
    userId: string,
    documentId: string,
    units: LibraryBookInput['units'],
  ): Promise<void> {
    const owner = toObjectId(userId);
    const docId = toObjectId(documentId);
    const LibraryUnit = mongoose.models.LibraryUnit;
    await LibraryUnit.deleteMany({ userId: owner, documentId: docId });
    for (let i = 0; i < units.length; i += UNIT_INSERT_BATCH) {
      await LibraryUnit.insertMany(
        units.slice(i, i + UNIT_INSERT_BATCH).map((unit) => ({
          ...unit,
          contentHtml: unit.contentHtml ?? '',
          userId: owner,
          documentId: docId,
        })),
      );
    }
  }

  async function replaceResources(
    userId: string,
    documentId: string,
    resources: LibraryResourceInput[],
  ): Promise<void> {
    const owner = toObjectId(userId);
    const docId = toObjectId(documentId);
    const LibraryResource = mongoose.models.LibraryResource;
    await LibraryResource.deleteMany({ userId: owner, documentId: docId });
    for (let i = 0; i < resources.length; i += RESOURCE_INSERT_BATCH) {
      await LibraryResource.insertMany(
        resources.slice(i, i + RESOURCE_INSERT_BATCH).map((resource) => ({
          path: resource.path,
          mediaType: resource.mediaType,
          bytes: Buffer.from(resource.bytes),
          size: resource.bytes.byteLength,
          userId: owner,
          documentId: docId,
        })),
      );
    }
  }

  async function getLibraryResource(
    userId: string,
    documentId: string,
    path: string,
  ): Promise<LibraryResourceRecord | null> {
    if (!Types.ObjectId.isValid(documentId) || typeof path !== 'string' || path.length === 0) {
      return null;
    }
    const doc = (await mongoose.models.LibraryResource.findOne({
      userId: toObjectId(userId),
      documentId: toObjectId(documentId),
      path,
    }).lean()) as unknown as ILibraryResource | null;
    if (!doc) {
      return null;
    }
    // A lean read hands back the driver's Binary wrapper rather than a Buffer.
    const raw = doc.bytes as unknown as Buffer | { buffer: Uint8Array };
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw.buffer);
    return { path: doc.path, mediaType: doc.mediaType, bytes };
  }

  async function saveLibrarySource(
    userId: string,
    documentId: string,
    bytes: Uint8Array,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(documentId) || bytes.byteLength === 0) {
      return false;
    }
    const owner = toObjectId(userId);
    const docId = toObjectId(documentId);
    const mine = await mongoose.models.LibraryDocument.exists({
      _id: docId,
      userId: owner,
      kind: 'pdf',
    });
    if (!mine) {
      return false;
    }
    const LibrarySource = mongoose.models.LibrarySource;
    await LibrarySource.deleteMany({ userId: owner, documentId: docId });
    for (let offset = 0, index = 0; offset < bytes.byteLength; index++) {
      const end = Math.min(offset + LIBRARY_SOURCE_CHUNK_BYTES, bytes.byteLength);
      await LibrarySource.create({
        userId: owner,
        documentId: docId,
        index,
        bytes: Buffer.from(bytes.subarray(offset, end)),
      });
      offset = end;
    }
    await mongoose.models.LibraryDocument.updateOne(
      { _id: docId, userId: owner },
      { $set: { hasSource: true } },
    );
    return true;
  }

  async function getLibrarySource(userId: string, documentId: string): Promise<Buffer | null> {
    if (!Types.ObjectId.isValid(documentId)) {
      return null;
    }
    const chunks = (await mongoose.models.LibrarySource.find({
      userId: toObjectId(userId),
      documentId: toObjectId(documentId),
    })
      .sort({ index: 1 })
      .lean()) as unknown as ILibrarySource[];
    if (chunks.length === 0) {
      return null;
    }
    // A lean read hands back the driver's Binary wrapper rather than a Buffer.
    return Buffer.concat(
      chunks.map((chunk) => {
        const raw = chunk.bytes as unknown as Buffer | { buffer: Uint8Array };
        return Buffer.isBuffer(raw) ? raw : Buffer.from(raw.buffer);
      }),
    );
  }

  async function deleteLibrarySource(userId: string, documentId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(documentId)) {
      return false;
    }
    const owner = toObjectId(userId);
    const docId = toObjectId(documentId);
    const result = await mongoose.models.LibrarySource.deleteMany({
      userId: owner,
      documentId: docId,
    });
    await mongoose.models.LibraryDocument.updateOne(
      { _id: docId, userId: owner },
      { $unset: { hasSource: '' } },
    );
    return result.deletedCount > 0;
  }

  async function listLibraryUnits(
    userId: string,
    documentId: string,
  ): Promise<LibraryUnitSummary[]> {
    if (!Types.ObjectId.isValid(documentId)) {
      return [];
    }
    const docs = (await mongoose.models.LibraryUnit.find(
      { userId: toObjectId(userId), documentId: toObjectId(documentId) },
      { contentHtml: 0, text: 0 },
    )
      .sort({ index: 1 })
      .lean()) as unknown as ILibraryUnit[];
    return docs.map(toUnitSummary);
  }

  async function getLibraryUnit(
    userId: string,
    documentId: string,
    index: number,
  ): Promise<LibraryUnitRecord | null> {
    if (!Types.ObjectId.isValid(documentId) || !Number.isInteger(index) || index < 0) {
      return null;
    }
    const doc = (await mongoose.models.LibraryUnit.findOne({
      userId: toObjectId(userId),
      documentId: toObjectId(documentId),
      index,
    }).lean()) as unknown as ILibraryUnit | null;
    return doc ? toUnitRecord(doc) : null;
  }

  async function getLibraryDocument(
    userId: string,
    id: string,
  ): Promise<LibraryDocumentRecord | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    const LibraryDocument = mongoose.models.LibraryDocument;
    const doc = (await LibraryDocument.findOne({
      _id: toObjectId(id),
      userId: toObjectId(userId),
    }).lean()) as unknown as ILibraryDocument | null;
    return doc ? toDocumentRecord(doc) : null;
  }

  async function listLibraryDocuments(
    userId: string,
    query: LibraryListQuery,
  ): Promise<LibraryDocumentSummary[]> {
    const LibraryDocument = mongoose.models.LibraryDocument;
    const filter: Record<string, unknown> = { userId: toObjectId(userId) };
    if (query.location) {
      filter.location = query.location;
    }
    if (query.tag) {
      filter.tags = query.tag;
    }
    const docs = (await LibraryDocument.find(filter, SUMMARY_PROJECTION)
      .sort({ updatedAt: -1, _id: -1 })
      .skip(query.skip ?? 0)
      .limit(query.limit)
      .lean()) as unknown as ILibraryDocument[];
    return docs.map(toSummary);
  }

  async function searchLibraryDocuments(
    userId: string,
    query: string,
    limit: number,
  ): Promise<LibraryDocumentSummary[]> {
    const term = query.trim();
    if (term.length === 0) {
      return [];
    }
    const LibraryDocument = mongoose.models.LibraryDocument;
    const docs = (await LibraryDocument.find(
      { userId: toObjectId(userId), $text: { $search: term } },
      { ...SUMMARY_PROJECTION, score: { $meta: 'textScore' } },
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .lean()) as unknown as ILibraryDocument[];
    return docs.map(toSummary);
  }

  async function updateLibraryDocument(
    userId: string,
    id: string,
    patch: LibraryDocumentPatch,
  ): Promise<LibraryDocumentSummary | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    const set: Record<string, unknown> = {};
    if (patch.location !== undefined) {
      set.location = patch.location;
    }
    if (patch.tags !== undefined) {
      set.tags = patch.tags;
    }
    const LibraryDocument = mongoose.models.LibraryDocument;
    const doc = (await LibraryDocument.findOneAndUpdate(
      { _id: toObjectId(id), userId: toObjectId(userId) },
      { $set: set },
      { new: true, projection: SUMMARY_PROJECTION },
    ).lean()) as unknown as ILibraryDocument | null;
    return doc ? toSummary(doc) : null;
  }

  async function deleteLibraryDocument(userId: string, id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) {
      return false;
    }
    const owner = toObjectId(userId);
    const documentId = toObjectId(id);
    const result = await mongoose.models.LibraryDocument.deleteOne({
      _id: documentId,
      userId: owner,
    });
    if (result.deletedCount === 0) {
      return false;
    }
    await Promise.all([
      mongoose.models.LibraryHighlight.deleteMany({ userId: owner, documentId }),
      mongoose.models.LibraryProgress.deleteMany({ userId: owner, documentId }),
      mongoose.models.LibraryUnit.deleteMany({ userId: owner, documentId }),
      mongoose.models.LibraryResource.deleteMany({ userId: owner, documentId }),
      mongoose.models.LibrarySource.deleteMany({ userId: owner, documentId }),
    ]);
    return true;
  }

  async function createLibraryHighlight(
    userId: string,
    input: LibraryHighlightInput,
  ): Promise<LibraryHighlightRecord | null> {
    if (!Types.ObjectId.isValid(input.documentId)) {
      return null;
    }
    const owner = toObjectId(userId);
    const documentId = toObjectId(input.documentId);
    const owned = await mongoose.models.LibraryDocument.exists({ _id: documentId, userId: owner });
    if (!owned) {
      return null;
    }
    const created = await mongoose.models.LibraryHighlight.create({
      userId: owner,
      documentId,
      anchor: toAnchor(input.anchor),
      color: input.color ?? 'yellow',
      note: input.note,
      tags: input.tags ?? [],
      unit: input.unit,
      contentHash: input.contentHash,
    });
    return toHighlightRecord(created.toObject() as unknown as ILibraryHighlight);
  }

  async function listLibraryHighlights(
    userId: string,
    documentId?: string,
    limit = 500,
  ): Promise<LibraryHighlightRecord[]> {
    const filter: Record<string, unknown> = { userId: toObjectId(userId) };
    if (documentId !== undefined) {
      if (!Types.ObjectId.isValid(documentId)) {
        return [];
      }
      filter.documentId = toObjectId(documentId);
    }
    const docs = (await mongoose.models.LibraryHighlight.find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit)
      .lean()) as unknown as ILibraryHighlight[];
    return docs.map(toHighlightRecord);
  }

  async function updateLibraryHighlight(
    userId: string,
    id: string,
    patch: LibraryHighlightPatch,
  ): Promise<LibraryHighlightRecord | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    if (patch.color !== undefined) {
      set.color = patch.color;
    }
    if (patch.tags !== undefined) {
      set.tags = patch.tags;
    }
    if (patch.note === null) {
      unset.note = 1;
    } else if (patch.note !== undefined) {
      set.note = patch.note;
    }
    const update: Record<string, unknown> = {};
    if (Object.keys(set).length > 0) {
      update.$set = set;
    }
    if (Object.keys(unset).length > 0) {
      update.$unset = unset;
    }
    const filter = { _id: toObjectId(id), userId: toObjectId(userId) };
    const LibraryHighlight = mongoose.models.LibraryHighlight;
    const doc = (Object.keys(update).length > 0
      ? await LibraryHighlight.findOneAndUpdate(filter, update, { new: true }).lean()
      : await LibraryHighlight.findOne(filter).lean()) as unknown as ILibraryHighlight | null;
    return doc ? toHighlightRecord(doc) : null;
  }

  async function deleteLibraryHighlight(userId: string, id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) {
      return false;
    }
    const result = await mongoose.models.LibraryHighlight.deleteOne({
      _id: toObjectId(id),
      userId: toObjectId(userId),
    });
    return result.deletedCount > 0;
  }

  async function reanchorLibraryHighlights(
    userId: string,
    documentId: string,
    results: LibraryReanchor[],
  ): Promise<number> {
    if (results.length === 0 || !Types.ObjectId.isValid(documentId)) {
      return 0;
    }
    const owner = toObjectId(userId);
    const docId = toObjectId(documentId);
    const operations = results
      .filter((result) => Types.ObjectId.isValid(result.id))
      .map((result) => ({
        updateOne: {
          filter: { _id: toObjectId(result.id), userId: owner, documentId: docId },
          update: {
            $set: result.anchor
              ? {
                  anchor: toAnchor(result.anchor),
                  orphaned: false,
                  contentHash: result.contentHash,
                }
              : { orphaned: true },
          },
        },
      }));
    if (operations.length === 0) {
      return 0;
    }
    const written = await tenantSafeBulkWrite(mongoose.models.LibraryHighlight, operations);
    return written.modifiedCount;
  }

  async function getLibraryProgress(
    userId: string,
    documentId: string,
  ): Promise<LibraryProgressRecord | null> {
    if (!Types.ObjectId.isValid(documentId)) {
      return null;
    }
    const doc = (await mongoose.models.LibraryProgress.findOne({
      userId: toObjectId(userId),
      documentId: toObjectId(documentId),
    }).lean()) as unknown as ILibraryProgress | null;
    return doc ? toProgressRecord(doc) : null;
  }

  async function setLibraryProgress(
    userId: string,
    documentId: string,
    textOffset: number,
    contentHash: string,
    unitIndex?: number,
  ): Promise<LibraryProgressRecord | null> {
    if (!Types.ObjectId.isValid(documentId)) {
      return null;
    }
    const owner = toObjectId(userId);
    const docId = toObjectId(documentId);
    const owned = await mongoose.models.LibraryDocument.exists({ _id: docId, userId: owner });
    if (!owned) {
      return null;
    }
    const doc = (await mongoose.models.LibraryProgress.findOneAndUpdate(
      { userId: owner, documentId: docId },
      unitIndex === undefined
        ? { $set: { textOffset, contentHash }, $unset: { unitIndex: 1 } }
        : { $set: { textOffset, contentHash, unitIndex } },
      { upsert: true, new: true },
    ).lean()) as unknown as ILibraryProgress;
    return toProgressRecord(doc);
  }

  async function addLibraryFeed(
    userId: string,
    input: LibraryFeedInput,
    maxFeeds: number,
  ): Promise<LibraryFeedAddResult> {
    const owner = toObjectId(userId);
    const LibraryFeed = mongoose.models.LibraryFeed;
    const existing = (await LibraryFeed.findOne({
      userId: owner,
      feedUrl: input.feedUrl,
    }).lean()) as unknown as ILibraryFeed | null;
    if (existing) {
      return { status: 'exists', feed: toFeedRecord(existing) };
    }
    if ((await LibraryFeed.countDocuments({ userId: owner })) >= maxFeeds) {
      return { status: 'limit' };
    }
    const created = await LibraryFeed.findOneAndUpdate(
      { userId: owner, feedUrl: input.feedUrl },
      {
        $setOnInsert: {
          userId: owner,
          feedUrl: input.feedUrl,
          title: input.title,
          ...(input.siteUrl ? { siteUrl: input.siteUrl } : {}),
          seenKeys: [],
        },
      },
      { upsert: true, new: true },
    ).lean();
    return { status: 'added', feed: toFeedRecord(created as unknown as ILibraryFeed) };
  }

  async function listLibraryFeeds(userId: string): Promise<LibraryFeedRecord[]> {
    const docs = (await mongoose.models.LibraryFeed.find({ userId: toObjectId(userId) })
      .sort({ createdAt: -1, _id: -1 })
      .lean()) as unknown as ILibraryFeed[];
    return docs.map(toFeedRecord);
  }

  async function getLibraryFeed(userId: string, id: string): Promise<LibraryFeedState | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    const doc = (await mongoose.models.LibraryFeed.findOne({
      _id: toObjectId(id),
      userId: toObjectId(userId),
    }).lean()) as unknown as ILibraryFeed | null;
    return doc ? toFeedState(doc) : null;
  }

  async function recordLibraryFeedRefresh(
    userId: string,
    id: string,
    refresh: LibraryFeedRefreshRecord,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) {
      return false;
    }
    const filter = { _id: toObjectId(id), userId: toObjectId(userId) };
    const LibraryFeed = mongoose.models.LibraryFeed;
    const set: Record<string, unknown> = { lastRefreshedAt: new Date() };
    const unset: Record<string, 1> = {};
    if (refresh.title) {
      set.title = refresh.title;
    }
    if (refresh.etag === null) {
      unset.etag = 1;
    } else if (refresh.etag !== undefined) {
      set.etag = refresh.etag;
    }
    if (refresh.lastModified === null) {
      unset.lastModified = 1;
    } else if (refresh.lastModified !== undefined) {
      set.lastModified = refresh.lastModified;
    }
    const update: Record<string, unknown> = {
      $set: set,
      ...(refresh.newKeys.length > 0
        ? { $push: { seenKeys: { $each: refresh.newKeys, $slice: -MAX_SEEN_KEYS } } }
        : {}),
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
    };
    const result = await LibraryFeed.updateOne(filter, update);
    return result.matchedCount > 0;
  }

  async function deleteLibraryFeed(userId: string, id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) {
      return false;
    }
    const result = await mongoose.models.LibraryFeed.deleteOne({
      _id: toObjectId(id),
      userId: toObjectId(userId),
    });
    return result.deletedCount > 0;
  }

  async function deleteAllLibraryData(userId: string): Promise<LibraryDataDeleteResult> {
    const owner = toObjectId(userId);
    const [documents, highlights, progress, units, resources, sources, feeds] = await Promise.all([
      mongoose.models.LibraryDocument.deleteMany({ userId: owner }),
      mongoose.models.LibraryHighlight.deleteMany({ userId: owner }),
      mongoose.models.LibraryProgress.deleteMany({ userId: owner }),
      mongoose.models.LibraryUnit.deleteMany({ userId: owner }),
      mongoose.models.LibraryResource.deleteMany({ userId: owner }),
      mongoose.models.LibrarySource.deleteMany({ userId: owner }),
      mongoose.models.LibraryFeed.deleteMany({ userId: owner }),
    ]);
    return {
      documents: documents.deletedCount,
      highlights: highlights.deletedCount,
      progress: progress.deletedCount,
      units: units.deletedCount,
      resources: resources.deletedCount,
      sources: sources.deletedCount,
      feeds: feeds.deletedCount,
    };
  }

  return {
    saveLibraryDocument,
    saveLibraryBook,
    getLibraryDocument,
    listLibraryUnits,
    getLibraryUnit,
    getLibraryResource,
    saveLibrarySource,
    getLibrarySource,
    deleteLibrarySource,
    listLibraryDocuments,
    searchLibraryDocuments,
    updateLibraryDocument,
    deleteLibraryDocument,
    createLibraryHighlight,
    listLibraryHighlights,
    updateLibraryHighlight,
    deleteLibraryHighlight,
    reanchorLibraryHighlights,
    getLibraryProgress,
    setLibraryProgress,
    addLibraryFeed,
    listLibraryFeeds,
    getLibraryFeed,
    recordLibraryFeedRefresh,
    deleteLibraryFeed,
    deleteAllLibraryData,
  };
}
