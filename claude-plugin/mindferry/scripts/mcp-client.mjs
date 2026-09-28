#!/usr/bin/env node
/**
 * A minimal MCP Streamable HTTP client for MindFerry's context hub —
 * exactly what a hook script needs (one tool call, one response), not a
 * general-purpose MCP client. No dependency on @modelcontextprotocol/sdk:
 * a plugin's hook scripts run in the user's shell, where only `node` is
 * guaranteed (Claude Code itself requires it), not an installed package.
 *
 * Verified against MindFerry's actual hub endpoint (packages/api/src/hub/mcp/http.ts):
 * it constructs a fresh server + transport per request in the SDK's stateless
 * mode (`sessionIdGenerator: undefined`), so a single self-contained
 * `tools/call` JSON-RPC request needs no prior `initialize` handshake and no
 * session id — confirmed by calling a live instance of that exact handler
 * directly, not assumed from the MCP spec's general (stateful) case.
 */

/**
 * @param {string} baseUrl - MindFerry's origin, e.g. https://mindferry.example.com
 * @param {string} apiKey - Agent API key (Settings -> API Keys -> Agent API Keys)
 * @param {string} name - tool name, e.g. "search_context"
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>} the tool result's text content
 */
export async function callHubTool(baseUrl, apiKey, name, args) {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/hub/mcp`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });

  if (!response.ok) {
    throw new Error(`MindFerry hub returned ${response.status}: ${await response.text()}`);
  }

  const raw = await response.text();
  const message = parseJsonRpcResponse(raw, response.headers.get('content-type') ?? '');

  if (message.error) {
    throw new Error(`MindFerry hub tool "${name}" failed: ${message.error.message}`);
  }
  const [first] = message.result?.content ?? [];
  if (!first || first.type !== 'text') {
    throw new Error(`MindFerry hub tool "${name}" returned no text content`);
  }
  return first.text;
}

/**
 * The Streamable HTTP transport wraps its single JSON-RPC response in one
 * SSE `data:` frame (`event: message\ndata: {...}\n\n`) rather than plain
 * JSON, even for a request expecting exactly one reply. Handles both that
 * and a plain `application/json` body, rather than assuming which one a
 * given deployment's proxy/transport version returns.
 */
function parseJsonRpcResponse(raw, contentType) {
  if (contentType.includes('application/json')) {
    return JSON.parse(raw);
  }
  const dataLine = raw
    .split('\n')
    .find((line) => line.startsWith('data:'))
    ?.slice('data:'.length)
    .trim();
  if (!dataLine) {
    throw new Error(`Could not find an SSE data frame in the hub's response: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(dataLine);
}
