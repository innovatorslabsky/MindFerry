import { logger } from '@librechat/data-schemas';
import type { HubMethods, HubNoteRecord, HubThreadRecord } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { HubContinueImport, HubContinueTarget } from './adapters/librechat';
import type { ServerRequest } from '../types/http';
import { convertHubNoteToChat, convertHubThreadToChat } from './adapters/librechat';
import { isConversationImportError } from '../conversations/import';
import { isContentFilterError } from '../middleware/contentFilter';
import { isContextHubEnabled } from './config';

export interface HubContinueImportParams {
  userId: string;
  userRole?: string;
  payload: HubContinueImport;
  req: ServerRequest;
}

export interface CreateContextHubContinueHandlerDeps {
  methods: Pick<HubMethods, 'getHubThread'>;
  /**
   * Saves the converted conversation through the app's own conversation
   * importer and returns the new conversation's id. Supplied by the caller —
   * the importer lives in the legacy `/api` workspace — so this handler is
   * exercised against a substitute at that boundary rather than a mock of it.
   */
  importConversation: (params: HubContinueImportParams) => Promise<{ conversationId: string }>;
}

type ContinueRequest = ServerRequest & {
  params: { id?: string };
  body?: { endpoint?: unknown; model?: unknown };
};

/** An endpoint or model name as the UI reports it: letters, digits and the punctuation model ids use. */
const NAME_PATTERN = /^[\w.:/@ -]{1,200}$/;

function errorBody(message: string, code: string, type = 'invalid_request_error') {
  return { error: { message, type, code } };
}

function optionalName(value: unknown): string | undefined {
  return typeof value === 'string' && NAME_PATTERN.test(value) ? value : undefined;
}

type ContinueSource<T> = {
  /** Used in the log line when an unexpected error escapes. */
  kind: string;
  load: (userId: string, id: string) => Promise<T | null>;
  convert: (record: T, target: HubContinueTarget) => HubContinueImport;
  notFound: { message: string; code: string };
  empty: { message: string; code: string };
};

/**
 * The request handling both "Continue in chat" routes share: the hub and
 * user checks, the caller-scoped read, the conversion, and handing the
 * result to the caller's importer — so a thread and a note can differ only
 * in how they are read and converted.
 */
function createContinueHandler<T>(
  source: ContinueSource<T>,
  importConversation: CreateContextHubContinueHandlerDeps['importConversation'],
): (req: ContinueRequest, res: Response) => Promise<void> {
  return async (req, res) => {
    if (!isContextHubEnabled(req.config)) {
      res.status(404).json(errorBody('Context hub is not enabled', 'not_found', 'not_found'));
      return;
    }

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json(errorBody('Authentication is required', 'unauthorized'));
      return;
    }

    const id = req.params.id;
    if (!id) {
      res.status(400).json(errorBody(`A ${source.kind} id is required`, 'no_id'));
      return;
    }

    try {
      const record = await source.load(userId, id);
      if (!record) {
        res.status(404).json(errorBody(source.notFound.message, source.notFound.code, 'not_found'));
        return;
      }

      const payload = source.convert(record, {
        endpoint: optionalName(req.body?.endpoint),
        model: optionalName(req.body?.model),
      });
      if (payload.messages.length === 0) {
        res.status(422).json(errorBody(source.empty.message, source.empty.code));
        return;
      }

      const { conversationId } = await importConversation({
        userId,
        userRole: req.user?.role,
        payload,
        req,
      });
      res.status(201).json({ conversationId, messageCount: payload.messages.length });
    } catch (error) {
      if (isContentFilterError(error) || isConversationImportError(error)) {
        res.status(error.statusCode).json(error.body);
        return;
      }
      logger.error(
        `[contextHubContinue] user: ${userId} | Error continuing ${source.kind} ${id}:`,
        error,
      );
      res.status(500).json(errorBody('Internal server error', 'internal_error', 'server_error'));
    }
  };
}

/**
 * "Continue in chat": opens an archived thread as an ordinary conversation
 * the person can keep talking in. The thread is converted and handed to the
 * caller's importer, which applies the same content filters, size limits and
 * model defaulting as any other import — this only adds the conversion. Each
 * call makes a new conversation; the archived thread itself is never changed.
 */
export function createContextHubContinueHandler(
  deps: CreateContextHubContinueHandlerDeps,
): (req: ContinueRequest, res: Response) => Promise<void> {
  return createContinueHandler<HubThreadRecord>(
    {
      kind: 'thread',
      load: deps.methods.getHubThread,
      convert: convertHubThreadToChat,
      notFound: { message: 'No archived conversation has that id', code: 'thread_not_found' },
      empty: {
        message: 'This conversation has no text a chat could continue from',
        code: 'empty_thread',
      },
    },
    deps.importConversation,
  );
}

export interface CreateContextHubNoteContinueHandlerDeps {
  methods: Pick<HubMethods, 'getHubNote'>;
  importConversation: CreateContextHubContinueHandlerDeps['importConversation'];
}

/**
 * "Continue in chat" for a note: opens a new conversation that starts from
 * the note, through the same importer as a thread. The note is read scoped to
 * the caller and is never changed.
 */
export function createContextHubNoteContinueHandler(
  deps: CreateContextHubNoteContinueHandlerDeps,
): (req: ContinueRequest, res: Response) => Promise<void> {
  return createContinueHandler<HubNoteRecord>(
    {
      kind: 'note',
      load: deps.methods.getHubNote,
      convert: convertHubNoteToChat,
      notFound: { message: 'No note has that id', code: 'note_not_found' },
      empty: { message: 'This note has no text a chat could start from', code: 'empty_note' },
    },
    deps.importConversation,
  );
}
