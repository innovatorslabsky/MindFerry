import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_HTML_CHARS,
  buildClipRequest,
  describeFailure,
  isSavableUrl,
  normalizeServer,
  saveClip,
} from '../clip.js';

test('normalizeServer keeps the origin and insists on https, except for a local server', () => {
  assert.equal(normalizeServer('mindferry.example.com'), 'https://mindferry.example.com');
  assert.equal(normalizeServer(' https://mf.example.com/some/path?x=1 '), 'https://mf.example.com');
  assert.equal(normalizeServer('http://localhost:3080/'), 'http://localhost:3080');
  assert.equal(normalizeServer('http://example.com'), null);
  assert.equal(normalizeServer('javascript:alert(1)'), null);
  assert.equal(normalizeServer(''), null);
  assert.equal(normalizeServer('not a url at all'), null);
});

test('only web pages are savable', () => {
  assert.equal(isSavableUrl('https://example.com/a'), true);
  assert.equal(isSavableUrl('http://example.com/a'), true);
  for (const bad of ['chrome://settings', 'file:///etc/passwd', 'about:blank', 'nope', '']) {
    assert.equal(isSavableUrl(bad), false, bad);
  }
});

test('the request carries the key and the page, and falls back to the link for a huge page', () => {
  const small = buildClipRequest({
    server: 'https://mf.example.com',
    apiKey: 'k1',
    url: 'https://example.com/a',
    html: '<p>hi</p>',
  });
  assert.equal(small.url, 'https://mf.example.com/api/library/clip');
  assert.equal(small.init.headers.Authorization, 'Bearer k1');
  assert.deepEqual(JSON.parse(small.init.body), {
    url: 'https://example.com/a',
    html: '<p>hi</p>',
  });

  const huge = buildClipRequest({
    server: 'https://mf.example.com',
    apiKey: 'k1',
    url: 'https://example.com/a',
    html: 'x'.repeat(MAX_HTML_CHARS + 1),
  });
  assert.deepEqual(JSON.parse(huge.init.body), { url: 'https://example.com/a' });

  const link = buildClipRequest({
    server: 'https://mf.example.com',
    apiKey: 'k1',
    url: 'https://e.com/',
  });
  assert.deepEqual(JSON.parse(link.init.body), { url: 'https://e.com/' });
});

test('failures are explained, by status and by the library error code', () => {
  assert.match(describeFailure(401), /API key/);
  assert.match(describeFailure(404), /not turned on/);
  assert.match(describeFailure(429), /Too many/);
  assert.match(describeFailure(400, 'unsafe_url'), /cannot fetch/);
  assert.match(describeFailure(422, 'not_readable'), /No readable article/);
  assert.match(describeFailure(413), /too large/);
  assert.match(describeFailure(500), /error 500/);
});

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('saveClip reports a new save, a repeat save and a refusal', async () => {
  const args = { server: 'https://mf.example.com', apiKey: 'k', url: 'https://example.com/a' };

  const created = await saveClip({
    ...args,
    fetchImpl: async () => response(201, { document: { title: 'T' } }),
  });
  assert.deepEqual(created, { ok: true, created: true, title: 'T' });

  const again = await saveClip({ ...args, fetchImpl: async () => response(200, {}) });
  assert.equal(again.created, false);

  const refused = await saveClip({
    ...args,
    fetchImpl: async () => response(401, { error: { code: 'invalid_api_key' } }),
  });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /API key/);
});

test('saveClip survives a network failure and refuses a page it cannot save', async () => {
  const down = await saveClip({
    server: 'https://mf.example.com',
    apiKey: 'k',
    url: 'https://example.com/a',
    fetchImpl: async () => {
      throw new TypeError('network');
    },
  });
  assert.equal(down.ok, false);
  assert.match(down.message, /Could not reach/);

  let called = false;
  const refused = await saveClip({
    server: 'https://mf.example.com',
    apiKey: 'k',
    url: 'chrome://settings',
    fetchImpl: async () => {
      called = true;
      return response(200, {});
    },
  });
  assert.equal(refused.ok, false);
  assert.equal(called, false);
});
