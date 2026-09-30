import { Types } from 'mongoose';
import type {
  HubNoteInput,
  HubNoteRecord,
  HubNoteSurface,
  HubThreadRecord,
  HubMessageRecord,
  HubDataDeleteResult,
  HubThreadSearchQuery,
  HubThreadSearchResult,
  HubOAuthClientInput,
  HubOAuthClientRecord,
} from '~/types';
import type { IHubThread, IHubMessage } from '~/schema/hubThread';
import type { IHubOAuthClient } from '~/schema/hubOAuthClient';
import type { IHubNote } from '~/schema/hubNote';
import logger from '~/config/winston';

export interface HubMethods {
  upsertHubThread: (userId: string, thread: HubThreadRecord) => Promise<void>;
  getHubThread: (userId: string, id: string) => Promise<HubThreadRecord | null>;
  searchHubThreads: (
    userId: string,
    params: HubThreadSearchQuery,
  ) => Promise<HubThreadSearchResult[]>;
  /** Most-recently-updated threads first, for browsing the archive without a search term. */
  listHubThreads: (
    userId: string,
    limit: number,
    surface?: HubNoteSurface,
  ) => Promise<HubThreadSearchResult[]>;
  /** Oldest first. With `limit`, the most recent `limit` notes, still oldest first. */
  listHubNotes: (userId: string, threadId?: string, limit?: number) => Promise<HubNoteRecord[]>;
  appendHubNote: (userId: string, note: HubNoteInput) => Promise<HubNoteRecord>;
  /** Best text match first; same term semantics as `searchHubThreads`. */
  searchHubNotes: (userId: string, query: string, limit: number) => Promise<HubNoteRecord[]>;
  deleteAllHubData: (userId: string) => Promise<HubDataDeleteResult>;
  /** Dynamic client registration (RFC 7591) is unauthenticated by design —
   *  no userId scoping, since a registered client belongs to the hub's OAuth
   *  server as a whole, not to whichever user's browser completes it. */
  registerHubOAuthClient: (client: HubOAuthClientInput) => Promise<HubOAuthClientRecord>;
  getHubOAuthClient: (clientId: string) => Promise<HubOAuthClientRecord | null>;
}

function toObjectId(userId: string): Types.ObjectId {
  return new Types.ObjectId(userId);
}

function buildSearchText(thread: HubThreadRecord): string {
  const pieces = [thread.title];
  for (const message of thread.messages) {
    for (const segment of message.segments) {
      pieces.push(segment.text);
    }
  }
  return pieces.join('\n');
}

function toMessageRecord(message: IHubMessage): HubMessageRecord {
  return {
    id: message.id,
    role: message.role,
    createdAt: message.createdAt,
    segments: message.segments.map((segment) => ({
      kind: segment.kind,
      text: segment.text,
      language: segment.language,
      name: segment.name,
    })),
    parentId: message.parentId,
    model: message.model,
  };
}

function toThreadRecord(doc: IHubThread): HubThreadRecord {
  return {
    id: doc.id,
    provider: doc.provider,
    surface: doc.surface,
    sourceId: doc.sourceId,
    title: doc.title,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    messages: doc.messages.map(toMessageRecord),
  };
}

/** `chat` is also what a thread archived before surfaces were recorded reads as. */
function surfaceFilter(surface: HubNoteSurface): Record<string, unknown> {
  if (surface === 'chat') {
    return { $or: [{ surface: 'chat' }, { surface: { $exists: false } }] };
  }
  return { surface };
}

function toSearchResult(doc: IHubThread): HubThreadSearchResult {
  return {
    id: doc.id,
    provider: doc.provider,
    surface: doc.surface,
    title: doc.title,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    messageCount: doc.messages.length,
    searchText: doc.searchText,
  };
}

function toOAuthClientRecord(doc: IHubOAuthClient): HubOAuthClientRecord {
  return {
    clientId: doc.clientId,
    clientName: doc.clientName,
    redirectUris: doc.redirectUris,
    createdAt: doc.createdAt,
  };
}

function toNoteRecord(doc: IHubNote): HubNoteRecord {
  return {
    id: (doc._id as Types.ObjectId).toString(),
    title: doc.title,
    text: doc.text,
    threadId: doc.threadId,
    surface: doc.surface,
    sessionTag: doc.sessionTag,
    createdAt: doc.createdAt,
  };
}

export function createHubMethods(mongoose: typeof import('mongoose')): HubMethods {
  async function upsertHubThread(userId: string, thread: HubThreadRecord): Promise<void> {
    const HubThread = mongoose.models.HubThread;
    try {
      await HubThread.updateOne(
        { userId: toObjectId(userId), id: thread.id },
        {
          $set: {
            userId: toObjectId(userId),
            id: thread.id,
            provider: thread.provider,
            ...(thread.surface ? { surface: thread.surface } : {}),
            sourceId: thread.sourceId,
            title: thread.title,
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
            messages: thread.messages,
            searchText: buildSearchText(thread),
            syncedAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      logger.error('[upsertHubThread] Error archiving thread:', error);
      throw error;
    }
  }

  async function getHubThread(userId: string, id: string): Promise<HubThreadRecord | null> {
    try {
      const HubThread = mongoose.models.HubThread;
      const doc = (await HubThread.findOne({
        userId: toObjectId(userId),
        id,
      }).lean()) as IHubThread | null;
      return doc ? toThreadRecord(doc) : null;
    } catch (error) {
      logger.error('[getHubThread] Error reading thread:', error);
      throw error;
    }
  }

  async function searchHubThreads(
    userId: string,
    params: HubThreadSearchQuery,
  ): Promise<HubThreadSearchResult[]> {
    const query = params.query.trim();
    if (query.length === 0) {
      return [];
    }
    try {
      const HubThread = mongoose.models.HubThread;
      const filter: Record<string, unknown> = {
        userId: toObjectId(userId),
        $text: { $search: query },
      };
      if (params.providers && params.providers.length > 0) {
        filter.provider = { $in: params.providers };
      }
      if (params.surface) {
        Object.assign(filter, surfaceFilter(params.surface));
      }

      const docs = (await HubThread.find(filter, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(params.limit)
        .lean()) as unknown as IHubThread[];

      return docs.map(toSearchResult);
    } catch (error) {
      logger.error('[searchHubThreads] Error searching threads:', error);
      throw error;
    }
  }

  async function listHubThreads(
    userId: string,
    limit: number,
    surface?: HubNoteSurface,
  ): Promise<HubThreadSearchResult[]> {
    try {
      const HubThread = mongoose.models.HubThread;
      const filter: Record<string, unknown> = { userId: toObjectId(userId) };
      if (surface) {
        Object.assign(filter, surfaceFilter(surface));
      }
      const docs = (await HubThread.find(filter)
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean()) as unknown as IHubThread[];

      return docs.map(toSearchResult);
    } catch (error) {
      logger.error('[listHubThreads] Error listing threads:', error);
      throw error;
    }
  }

  async function listHubNotes(
    userId: string,
    threadId?: string,
    limit?: number,
  ): Promise<HubNoteRecord[]> {
    try {
      const HubNote = mongoose.models.HubNote;
      const filter: Record<string, unknown> = { userId: toObjectId(userId) };
      if (threadId !== undefined) {
        filter.threadId = threadId;
      }
      if (limit === undefined) {
        const docs = (await HubNote.find(filter)
          .sort({ createdAt: 1 })
          .lean()) as unknown as IHubNote[];
        return docs.map(toNoteRecord);
      }
      const newest = (await HubNote.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()) as unknown as IHubNote[];
      return newest.reverse().map(toNoteRecord);
    } catch (error) {
      logger.error('[listHubNotes] Error listing notes:', error);
      throw error;
    }
  }

  async function searchHubNotes(
    userId: string,
    query: string,
    limit: number,
  ): Promise<HubNoteRecord[]> {
    const terms = query.trim();
    if (terms.length === 0) {
      return [];
    }
    try {
      const HubNote = mongoose.models.HubNote;
      const docs = (await HubNote.find(
        { userId: toObjectId(userId), $text: { $search: terms } },
        { score: { $meta: 'textScore' } },
      )
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .lean()) as unknown as IHubNote[];
      return docs.map(toNoteRecord);
    } catch (error) {
      logger.error('[searchHubNotes] Error searching notes:', error);
      throw error;
    }
  }

  async function appendHubNote(userId: string, note: HubNoteInput): Promise<HubNoteRecord> {
    try {
      const HubNote = mongoose.models.HubNote;
      const doc = await HubNote.create({
        userId: toObjectId(userId),
        title: note.title,
        text: note.text,
        threadId: note.threadId,
        surface: note.surface,
        sessionTag: note.sessionTag,
      });
      return toNoteRecord(doc);
    } catch (error) {
      logger.error('[appendHubNote] Error appending note:', error);
      throw error;
    }
  }

  async function deleteAllHubData(userId: string): Promise<HubDataDeleteResult> {
    try {
      const HubThread = mongoose.models.HubThread;
      const HubNote = mongoose.models.HubNote;
      const [threads, notes] = await Promise.all([
        HubThread.deleteMany({ userId: toObjectId(userId) }),
        HubNote.deleteMany({ userId: toObjectId(userId) }),
      ]);
      return {
        deletedThreads: threads.deletedCount ?? 0,
        deletedNotes: notes.deletedCount ?? 0,
      };
    } catch (error) {
      logger.error('[deleteAllHubData] Error deleting hub data:', error);
      throw error;
    }
  }

  async function registerHubOAuthClient(
    client: HubOAuthClientInput,
  ): Promise<HubOAuthClientRecord> {
    try {
      const HubOAuthClient = mongoose.models.HubOAuthClient;
      const doc = await HubOAuthClient.create({
        clientId: client.clientId,
        clientName: client.clientName,
        redirectUris: client.redirectUris,
      });
      return toOAuthClientRecord(doc);
    } catch (error) {
      logger.error('[registerHubOAuthClient] Error registering OAuth client:', error);
      throw error;
    }
  }

  async function getHubOAuthClient(clientId: string): Promise<HubOAuthClientRecord | null> {
    try {
      const HubOAuthClient = mongoose.models.HubOAuthClient;
      const doc = (await HubOAuthClient.findOne({ clientId }).lean()) as IHubOAuthClient | null;
      return doc ? toOAuthClientRecord(doc) : null;
    } catch (error) {
      logger.error('[getHubOAuthClient] Error reading OAuth client:', error);
      throw error;
    }
  }

  return {
    upsertHubThread,
    getHubThread,
    searchHubThreads,
    listHubThreads,
    listHubNotes,
    searchHubNotes,
    appendHubNote,
    deleteAllHubData,
    registerHubOAuthClient,
    getHubOAuthClient,
  };
}
