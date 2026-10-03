import { rateLimit } from 'express-rate-limit';
import { logger } from '@librechat/data-schemas';
import type { HubMethods } from '@librechat/data-schemas';
import type { RequestHandler, Response } from 'express';
import type { ServerRequest } from '../types/http';
import type { HubSurface } from './thread';
import { contextHubRateLimitKey } from './ratelimit';
import { isContextHubEnabled } from './config';
import { HUB_SURFACES } from './thread';

/**
 * Read-only browsing of a user's own archive from MindFerry's own UI — the
 * counterpart to the MCP tools an external client uses, for a person who
 * just wants to look at what's in there without going through an AI. Gated
 * by `contextHub.enabled` alone, like the archive and import routes, since
 * browsing the archive doesn't require exposing it over MCP.
 */

export const CONTEXT_HUB_BROWSE_RATE_WINDOW_MS: number = 60_000;
export const CONTEXT_HUB_BROWSE_RATE_MAX: number = 60;

export const contextHubBrowseLimiter: RequestHandler = rateLimit({
  windowMs: CONTEXT_HUB_BROWSE_RATE_WINDOW_MS,
  max: CONTEXT_HUB_BROWSE_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => contextHubRateLimitKey(req as ServerRequest),
});

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

function clampLimit(raw: unknown): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(parsed, MAX_LIST_LIMIT);
}

function parseSurface(raw: unknown): HubSurface | undefined {
  return HUB_SURFACES.find((surface) => surface === raw);
}

function requireUserId(req: ServerRequest, res: Response): string | undefined {
  if (!isContextHubEnabled(req.config)) {
    res.status(404).json({
      error: { message: 'Context hub is not enabled', type: 'not_found', code: 'not_found' },
    });
    return undefined;
  }
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({
      error: {
        message: 'Authentication is required',
        type: 'invalid_request_error',
        code: 'unauthorized',
      },
    });
    return undefined;
  }
  return userId;
}

export interface CreateHubListThreadsHandlerDeps {
  methods: Pick<HubMethods, 'listHubThreads' | 'searchHubThreads'> &
    Partial<Pick<HubMethods, 'linkHubThreadChats'>>;
  /**
   * Which of these conversation ids are still chats the user can open —
   * supplied by the caller, whose conversation store this module does not
   * own. Used by `excludeLive` to leave out a thread that is already a chat
   * in the chat list, so it is not shown twice.
   */
  findLiveConversationIds?: (userId: string, conversationIds: string[]) => Promise<string[]>;
  /**
   * The user's chats titled exactly one of these, for threads opened as chats
   * before chats were linked to the thread they came from. A match is linked
   * from then on, so it keeps holding after the chat is renamed.
   */
  findConvosByTitles?: (
    userId: string,
    titles: string[],
  ) => Promise<Array<{ conversationId: string; title: string }>>;
}

const MINDFERRY_PREFIX = 'mindferry:';

type ListedThread = {
  id: string;
  provider: string;
  title: string;
  chatConversationIds?: string[];
};

/** The chats a thread already is: its own chat for a MindFerry chat, plus any opened from it. */
function chatIdsOf(thread: ListedThread): string[] {
  const own =
    thread.provider === 'mindferry' && thread.id.startsWith(MINDFERRY_PREFIX)
      ? [thread.id.slice(MINDFERRY_PREFIX.length)]
      : [];
  return [...own, ...(thread.chatConversationIds ?? [])];
}

/** Links threads never linked to a chat to a chat of the same title, and returns the ids so linked. */
async function linkByTitle(
  threads: ListedThread[],
  userId: string,
  deps: CreateHubListThreadsHandlerDeps,
): Promise<Set<string>> {
  const { findConvosByTitles, methods } = deps;
  const unlinked = threads.filter((thread) => !thread.chatConversationIds?.length);
  if (!findConvosByTitles || unlinked.length === 0) {
    return new Set();
  }
  const chats = await findConvosByTitles(userId, [
    ...new Set(unlinked.map((thread) => thread.title)),
  ]);
  const chatsByTitle = new Map<string, string>();
  for (const chat of chats) {
    chatsByTitle.set(chat.title, chat.conversationId);
  }
  const links = unlinked.flatMap((thread) => {
    const conversationId = chatsByTitle.get(thread.title);
    return conversationId ? [{ threadId: thread.id, conversationId }] : [];
  });
  if (links.length > 0 && methods.linkHubThreadChats) {
    try {
      await methods.linkHubThreadChats(userId, links);
    } catch (error) {
      logger.warn('[hubListThreads] Could not record chats matched by title:', error);
    }
  }
  return new Set(links.map((link) => link.threadId));
}

async function withoutLiveChats<T extends ListedThread>(
  threads: T[],
  userId: string,
  deps: CreateHubListThreadsHandlerDeps & {
    findLiveConversationIds: NonNullable<
      CreateHubListThreadsHandlerDeps['findLiveConversationIds']
    >;
  },
): Promise<T[]> {
  const chatIds = [...new Set(threads.flatMap(chatIdsOf))];
  const [live, matchedByTitle] = await Promise.all([
    chatIds.length > 0
      ? deps.findLiveConversationIds(userId, chatIds).then((ids) => new Set(ids))
      : Promise.resolve(new Set<string>()),
    linkByTitle(threads, userId, deps),
  ]);
  return threads.filter(
    (thread) =>
      !matchedByTitle.has(thread.id) && !chatIdsOf(thread).some((chatId) => live.has(chatId)),
  );
}

/**
 * `GET /api/hub/threads?q=&limit=&surface=&excludeLive=` — a search term lists
 * matches, its absence lists recent threads; `surface` narrows to one client;
 * `excludeLive=true` drops threads that already are a chat in the chat list —
 * a MindFerry chat's own copy, or a thread opened or imported as a chat — so
 * each conversation shows in one place.
 */
export function createHubListThreadsHandler(
  deps: CreateHubListThreadsHandlerDeps,
): (req: ServerRequest, res: Response) => Promise<void> {
  const { methods, findLiveConversationIds } = deps;

  return async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
      return;
    }

    const limit = clampLimit(req.query.limit);
    const excludeLive = req.query.excludeLive === 'true' && findLiveConversationIds != null;
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const surface = parseSurface(req.query.surface);

    const found = query
      ? await methods.searchHubThreads(userId, { query, limit, surface })
      : await methods.listHubThreads(userId, limit, surface);
    const threads = excludeLive
      ? await withoutLiveChats(found, userId, { ...deps, findLiveConversationIds })
      : found;

    res.status(200).json({ threads });
  };
}

export interface CreateHubGetThreadHandlerDeps {
  methods: Pick<HubMethods, 'getHubThread'>;
}

type GetThreadRequest = ServerRequest & { params: { id?: string } };

/** `GET /api/hub/threads/:id` — one archived conversation in full. */
export function createHubGetThreadHandler(
  deps: CreateHubGetThreadHandlerDeps,
): (req: GetThreadRequest, res: Response) => Promise<void> {
  const { methods } = deps;

  return async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
      return;
    }

    const id = req.params.id;
    if (!id) {
      res.status(400).json({
        error: { message: 'A thread id is required', type: 'invalid_request_error', code: 'no_id' },
      });
      return;
    }

    const thread = await methods.getHubThread(userId, id);
    if (!thread) {
      res.status(404).json({
        error: {
          message: 'No archived conversation has that id',
          type: 'not_found',
          code: 'thread_not_found',
        },
      });
      return;
    }

    res.status(200).json({ thread });
  };
}

export interface CreateHubListNotesHandlerDeps {
  methods: Pick<HubMethods, 'listHubNotes'>;
}

/** `GET /api/hub/notes?threadId=` — every note, or only those anchored to one thread. */
export function createHubListNotesHandler(
  deps: CreateHubListNotesHandlerDeps,
): (req: ServerRequest, res: Response) => Promise<void> {
  const { methods } = deps;

  return async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
      return;
    }

    const threadId = typeof req.query.threadId === 'string' ? req.query.threadId : undefined;
    const notes = await methods.listHubNotes(userId, threadId);
    res.status(200).json({ notes });
  };
}

export interface CreateHubDeleteNoteHandlerDeps {
  methods: Pick<HubMethods, 'deleteHubNote'>;
}

type DeleteNoteRequest = ServerRequest & { params: { id?: string } };

/** `DELETE /api/hub/notes/:id` — removes one of the caller's own notes. */
export function createHubDeleteNoteHandler(
  deps: CreateHubDeleteNoteHandlerDeps,
): (req: DeleteNoteRequest, res: Response) => Promise<void> {
  const { methods } = deps;

  return async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
      return;
    }

    const id = req.params.id;
    if (!id) {
      res.status(400).json({
        error: { message: 'A note id is required', type: 'invalid_request_error', code: 'no_id' },
      });
      return;
    }

    const deleted = await methods.deleteHubNote(userId, id);
    if (!deleted) {
      res.status(404).json({
        error: { message: 'No note has that id', type: 'not_found', code: 'note_not_found' },
      });
      return;
    }

    res.status(204).end();
  };
}
