/**
 * The one Slack Web API call this bridge needs — posting the agent's reply
 * back into the channel/thread it came from. Kept separate from
 * `slackBridge.ts` so a different `postToSlack` implementation (or a mock
 * in tests) is a plain function swap, not a change to the relay logic.
 */
export interface PostToSlackInput {
  channel: string;
  text: string;
  threadTs?: string;
}

export function createSlackWebApiClient(botToken: string, fetchFn: typeof fetch = fetch) {
  return {
    async postToSlack(input: PostToSlackInput): Promise<void> {
      const response = await fetchFn('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify({
          channel: input.channel,
          text: input.text,
          ...(input.threadTs != null && { thread_ts: input.threadTs }),
        }),
      });

      const body = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !body.ok) {
        throw new Error(`Slack chat.postMessage failed: ${body.error ?? response.status}`);
      }
    },
  };
}

interface MessageLike {
  isCreatedByUser?: boolean;
  sender?: string;
  text?: string;
  createdAt?: string | Date;
}

/**
 * Picks the reply to relay: the most recently created message that isn't
 * the user's own — matches how the trigger API's `fire` produces exactly
 * one new assistant turn per Slack message, so "most recent, not from the
 * user" is unambiguous rather than a heuristic guess.
 */
export function extractLastAssistantText(messages: readonly MessageLike[]): string | undefined {
  const assistantMessages = messages.filter((message) => !message.isCreatedByUser);
  if (assistantMessages.length === 0) {
    return undefined;
  }
  const sorted = [...assistantMessages].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
  const text = sorted[0].text;
  return text && text.trim().length > 0 ? text : undefined;
}
