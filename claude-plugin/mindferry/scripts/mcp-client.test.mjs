import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { callHubTool } from './mcp-client.mjs';

/** Wraps the response the exact same way MindFerry's real Streamable HTTP
 *  transport does — verified by calling `handleHubMcpRequest` directly (see
 *  packages/api/src/hub/mcp/http.ts) during development of this script, not
 *  assumed from the MCP spec's general case. */
function startFakeHub({ status = 200, sse = true, body }) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const request = JSON.parse(raw);
        const resolvedBody = typeof body === 'function' ? body(request) : body;
        if (sse) {
          res.writeHead(status, { 'Content-Type': 'text/event-stream' });
          res.end(`event: message\ndata: ${JSON.stringify(resolvedBody)}\n\n`);
        } else {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(resolvedBody));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => server.close(),
      });
    });
  });
}

test('parses an SSE-wrapped success response and returns the text content', async (t) => {
  const server = await startFakeHub({
    body: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'hello back' }] } },
  });
  t.after(() => server.close());

  const text = await callHubTool(server.url, 'test-key', 'read_notes', {});

  assert.equal(text, 'hello back');
});

test('also parses a plain application/json response (not SSE)', async (t) => {
  const server = await startFakeHub({
    sse: false,
    body: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'json reply' }] } },
  });
  t.after(() => server.close());

  const text = await callHubTool(server.url, 'test-key', 'read_notes', {});

  assert.equal(text, 'json reply');
});

test('sends the tool name and arguments in a well-formed tools/call request', async (t) => {
  let captured;
  const server = await startFakeHub({
    body: (request) => {
      captured = request;
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: { content: [{ type: 'text', text: 'ok' }] },
      };
    },
  });
  t.after(() => server.close());

  await callHubTool(server.url, 'my-key', 'append_note', { title: 't', text: 'x' });

  assert.equal(captured.method, 'tools/call');
  assert.equal(captured.params.name, 'append_note');
  assert.deepEqual(captured.params.arguments, { title: 't', text: 'x' });
});

test('sends the API key as a Bearer authorization header', async (t) => {
  let authHeader;

  // startFakeHub doesn't expose headers by default — build one inline here
  // to check the exact header this client sends.
  const headerServer = createServer((req, res) => {
    authHeader = req.headers.authorization;
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: 'ok' }] },
        })}\n\n`,
      );
    });
  });
  await new Promise((resolve) => headerServer.listen(0, '127.0.0.1', resolve));
  t.after(() => headerServer.close());
  const headerUrl = `http://127.0.0.1:${headerServer.address().port}`;

  await callHubTool(headerUrl, 'secret-key-123', 'read_notes', {});

  assert.equal(authHeader, 'Bearer secret-key-123');
});

test('trims a trailing slash from the base URL', async (t) => {
  let requestedPath;
  const server = createServer((req, res) => {
    requestedPath = req.url;
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: 'ok' }] },
        })}\n\n`,
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  await callHubTool(`http://127.0.0.1:${server.address().port}/`, 'k', 'read_notes', {});

  assert.equal(requestedPath, '/api/hub/mcp');
});

test('throws with the JSON-RPC error message when the hub reports a tool error', async (t) => {
  const server = await startFakeHub({
    body: { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'thread not found' } },
  });
  t.after(() => server.close());

  await assert.rejects(
    () => callHubTool(server.url, 'k', 'get_thread', { id: 'missing' }),
    /thread not found/,
  );
});

test('throws with the HTTP status when the hub rejects the request', async (t) => {
  const server = await startFakeHub({ status: 401, body: { error: 'unauthorized' } });
  t.after(() => server.close());

  await assert.rejects(() => callHubTool(server.url, 'wrong-key', 'read_notes', {}), /401/);
});

test('throws a clear error when the response has no text content', async (t) => {
  const server = await startFakeHub({
    body: { jsonrpc: '2.0', id: 1, result: { content: [] } },
  });
  t.after(() => server.close());

  await assert.rejects(() => callHubTool(server.url, 'k', 'read_notes', {}), /no text content/);
});

test('throws with the tool text when the hub reports a tool-level error', async (t) => {
  const server = await startFakeHub({
    body: {
      jsonrpc: '2.0',
      id: 1,
      result: { isError: true, content: [{ type: 'text', text: 'over the 6000000-byte limit' }] },
    },
  });
  t.after(() => server.close());

  await assert.rejects(
    () => callHubTool(server.url, 'test-key', 'archive_thread', {}),
    /"archive_thread" reported an error: over the 6000000-byte limit/,
  );
});
