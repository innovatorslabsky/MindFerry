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
  LibraryHighlightInput,
  LibraryHighlightPatch,
  LibraryHighlightRecord,
  LibraryListQuery,
  LibraryProgressRecord,
  LibraryReanchor,
  LibraryUnitRecord,
  LibraryUnitSummary,
} from '~/types';
import type { ILibraryDocument } from '~/schema/libraryDocument';
import type { ILibraryHighlight } from '~/schema/libraryHighlight';
import type { ILibraryProgress } from '~/schema/libraryProgress';
import type { ILibraryUnit } from '~/schema/libraryUnit';
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
  deleteAllLibraryData: (userId: string) => Promise<LibraryDataDeleteResult>;
}

const UNIT_INSERT_BATCH = 100;

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
    ...(doc.readableText === undefined ? {} : { readableText: doc.readableText }),
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
    const { units, ...documentInput } = input;
    const saved = await saveLibraryDocument(userId, {
      ...documentInput,
      kind: input.kind ?? (units[0]?.kind === 'page' ? 'pdf' : 'epub'),
      unitCount: units.length,
    });
    // Same file, same units: nothing to rewrite. A new or changed book replaces its units whole,
    // so a failed earlier attempt that left only some of them is repaired by the next save.
    const stored = await mongoose.models.LibraryUnit.countDocuments({
      userId: toObjectId(userId),
      documentId: toObjectId(saved.document.id),
    });
    if (saved.created || saved.contentChanged || stored !== units.length) {
      await replaceUnits(userId, saved.document.id, units);
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

  async function listLibraryUnits(
    userId: string,
    documentId: string,
  ): Promise<LibraryUnitSummary[]> {
    if (!Types.ObjectId.isValid(documentId)) {
      return [];
    }
    const docs = (await mongoose.models.LibraryUnit.find(
      { userId: toObjectId(userId), documentId: toObjectId(documentId) },
      { contentHtml: 0, text: 0, readableText: 0 },
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

  async function deleteAllLibraryData(userId: string): Promise<LibraryDataDeleteResult> {
    const owner = toObjectId(userId);
    const [documents, highlights, progress, units] = await Promise.all([
      mongoose.models.LibraryDocument.deleteMany({ userId: owner }),
      mongoose.models.LibraryHighlight.deleteMany({ userId: owner }),
      mongoose.models.LibraryProgress.deleteMany({ userId: owner }),
      mongoose.models.LibraryUnit.deleteMany({ userId: owner }),
    ]);
    return {
      documents: documents.deletedCount,
      highlights: highlights.deletedCount,
      progress: progress.deletedCount,
      units: units.deletedCount,
    };
  }

  return {
    saveLibraryDocument,
    saveLibraryBook,
    getLibraryDocument,
    listLibraryUnits,
    getLibraryUnit,
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
    deleteAllLibraryData,
  };
}
