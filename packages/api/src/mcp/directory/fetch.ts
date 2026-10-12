import type { MCPDirectoryFetchOptions } from './service';

/**
 * Downloads a text document over HTTPS with a timeout and a hard byte cap, so
 * an operator-configured source that turns out to be huge cannot be buffered
 * whole. Reads the body stream and aborts as soon as the cap is crossed.
 */
export async function fetchTextWithLimit(
  url: string,
  { timeoutMs, maxBytes }: MCPDirectoryFetchOptions,
): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || !response.body) {
    throw new Error(`Directory source responded with ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new Error(`Directory source exceeds ${maxBytes} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
}
