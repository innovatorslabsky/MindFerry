import { logger } from '@librechat/data-schemas';
import type { AppConfig, HubMethods } from '@librechat/data-schemas';
import type { LibreChatArchiveMessage, LibreChatArchiveConversation } from './adapters/librechat';
import { convertLibreChatConversation } from './adapters/librechat';
import { createConfiguredGitArchiveTarget } from './git/config';
import { archiveThreadToTargets } from './archiveTargets';
import { isContextHubEnabled } from './config';

/** What saving a conversation to the hub reads and writes, supplied by the caller. */
export interface ConversationHubDeps {
  methods: Pick<HubMethods, 'upsertHubThread'>;
  /** Loads the conversation, scoped to its owner; `null`/`undefined` means not found or not theirs. */
  getConvo: (
    userId: string,
    conversationId: string,
  ) => Promise<LibreChatArchiveConversation | null | undefined>;
  getMessages: (params: {
    conversationId: string;
    user: string;
  }) => Promise<LibreChatArchiveMessage[]>;
}

export interface SavedConversation {
  threadId: string;
  messageCount: number;
}

/**
 * Saves one of the user's own conversations into the hub as a thread keyed by
 * its conversation id, so saving it again updates the same thread. Returns
 * `null` when the user has no conversation with that id. Errors propagate.
 */
export async function saveConversationToHub(
  deps: ConversationHubDeps,
  userId: string,
  conversationId: string,
  config: AppConfig | undefined,
): Promise<SavedConversation | null> {
  const conversation = await deps.getConvo(userId, conversationId);
  if (!conversation) {
    return null;
  }
  const messages = await deps.getMessages({ conversationId, user: userId });
  const thread = convertLibreChatConversation(conversation, messages);
  await archiveThreadToTargets(
    { methods: deps.methods, git: createConfiguredGitArchiveTarget(config?.contextHub?.git) },
    userId,
    thread,
  );
  return { threadId: thread.id, messageCount: thread.messages.length };
}

/**
 * How archiving a chat went on the hub side: saved there, skipped because the
 * hub is off, or failed. The chat itself is archived either way.
 */
export type ArchiveHubSync = 'saved' | 'disabled' | 'failed';

/**
 * What the chat-archive route calls once a chat has been archived: archiving
 * is also saving to the hub, so Claude.ai and Claude Code can read the chat.
 * Never throws — a hub failure is reported, not allowed to undo the archive.
 */
export function createArchiveHubSync(
  deps: ConversationHubDeps,
): (params: {
  userId: string;
  conversationId: string;
  config: AppConfig | undefined;
}) => Promise<ArchiveHubSync> {
  return async ({ userId, conversationId, config }) => {
    if (!isContextHubEnabled(config)) {
      return 'disabled';
    }
    try {
      const saved = await saveConversationToHub(deps, userId, conversationId, config);
      return saved ? 'saved' : 'failed';
    } catch (error) {
      logger.error(
        `[archiveHubSync] user: ${userId} | Error saving archived conversation ${conversationId}:`,
        error,
      );
      return 'failed';
    }
  };
}
