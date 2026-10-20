import { useRecoilValue } from 'recoil';
import { LocalStorageKeys, isAgentsEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';
import store from '~/store';

/**
 * The endpoint and model of the chat the person has open, so the new one runs on them. Agent and
 * assistant chats are left out: they need an agent or assistant a plain conversation does not have.
 */
export function targetOf(
  conversation: { endpoint?: string | null; model?: string | null } | null,
): { endpoint: string; model: string } | undefined {
  const endpoint = conversation?.endpoint;
  const model = conversation?.model;
  if (!endpoint || !model || isAgentsEndpoint(endpoint) || isAssistantsEndpoint(endpoint)) {
    return undefined;
  }
  return { endpoint, model };
}

/** The endpoint and model of the person's last chat, as the app stored them; none if unreadable. */
function lastSetup(): { endpoint?: string | null; model?: string | null } | null {
  try {
    const raw = localStorage.getItem(`${LocalStorageKeys.LAST_CONVO_SETUP}_0`);
    return raw ? (JSON.parse(raw) as { endpoint?: string | null; model?: string | null }) : null;
  } catch {
    return null;
  }
}

/**
 * Where a chat-less screen should run a model: the chat that is open, or else the person's last one.
 * A page opened directly has no chat in memory yet, but the last setup is still stored.
 */
export function useChatTarget(): { endpoint: string; model: string } | undefined {
  const conversation = useRecoilValue(store.conversationByIndex(0));
  return targetOf(conversation) ?? targetOf(lastSetup());
}
