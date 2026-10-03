import { logger } from '@librechat/data-schemas';
import type { HubMethods } from '@librechat/data-schemas';
import type { CreateContextHubContinueHandlerDeps } from '../continueRoute';
import type { ServerRequest } from '../../types/http';
import { isConversationImportError } from '../../conversations/import';
import { isContentFilterError } from '../../middleware/contentFilter';
import { convertHubThreadToChat } from '../adapters/librechat';

/** How opening an archived thread as a MindFerry chat went, as `open_in_chat` reports it. */
export type HubOpenInChatResult =
  | { status: 'opened'; conversationId: string; messageCount: number; url?: string }
  | { status: 'not_found' }
  | { status: 'empty' }
  | { status: 'refused'; message: string };

export type HubOpenInChat = (threadId: string) => Promise<HubOpenInChatResult>;

export interface CreateHubOpenInChatDeps {
  methods: Pick<HubMethods, 'getHubThread'>;
  importConversation: CreateContextHubContinueHandlerDeps['importConversation'];
  /** The app's public origin; when set, the result carries a link to the new chat. */
  clientOrigin?: string;
}

function chatUrl(origin: string | undefined, conversationId: string): string | undefined {
  if (!origin) {
    return undefined;
  }
  try {
    return new URL(`/c/${encodeURIComponent(conversationId)}`, origin).href;
  } catch {
    return undefined;
  }
}

function refusalMessage(error: unknown): string | undefined {
  if (isConversationImportError(error)) {
    return error.body.message;
  }
  if (isContentFilterError(error)) {
    return 'The content filter refused this conversation.';
  }
  return undefined;
}

/**
 * The MCP counterpart of "Continue in chat": turns one of the caller's
 * archived threads into an ordinary MindFerry conversation, through the same
 * importer and limits. Bound to one request's user, like the hub store.
 * Unexpected errors propagate; a refusal by the importer is reported.
 */
export function createHubOpenInChat(
  deps: CreateHubOpenInChatDeps,
  req: ServerRequest & { user: { id: string; role?: string } },
): HubOpenInChat {
  const userId = req.user.id;
  return async (threadId) => {
    const thread = await deps.methods.getHubThread(userId, threadId);
    if (!thread) {
      return { status: 'not_found' };
    }
    const payload = convertHubThreadToChat(thread);
    if (payload.messages.length === 0) {
      return { status: 'empty' };
    }
    try {
      const { conversationId } = await deps.importConversation({
        userId,
        userRole: req.user.role,
        payload,
        req,
      });
      return {
        status: 'opened',
        conversationId,
        messageCount: payload.messages.length,
        url: chatUrl(deps.clientOrigin, conversationId),
      };
    } catch (error) {
      const message = refusalMessage(error);
      if (message === undefined) {
        throw error;
      }
      logger.warn(`[hubOpenInChat] user: ${userId} | Import refused for ${threadId}: ${message}`);
      return { status: 'refused', message };
    }
  };
}
