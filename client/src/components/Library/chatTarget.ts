import { isAgentsEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';

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
