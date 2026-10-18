/** The part of the extension that decides what to send and how to read the answer. No browser APIs here. */

/** The largest page the server accepts directly; a bigger one is sent as a link for the server to fetch. */
export const MAX_HTML_CHARS = 2_000_000;

/** `https://host[:port]` of a MindFerry server from whatever the person typed, or null if it is not one. */
export function normalizeServer(input) {
  const text = String(input ?? '').trim();
  if (text === '') {
    return null;
  }
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    return null;
  }
  return url.origin;
}

/** Only web pages can be saved: not the browser's own pages, files or extensions. */
export function isSavableUrl(value) {
  try {
    const { protocol } = new URL(String(value));
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** The request that saves a page: its address, and its HTML when the browser already holds it. */
export function buildClipRequest({ server, apiKey, url, html }) {
  const body = { url };
  if (typeof html === 'string' && html.length > 0 && html.length <= MAX_HTML_CHARS) {
    body.html = html;
  }
  return {
    url: `${server}/api/library/clip`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    },
  };
}

/** What went wrong, in words the person can act on, from the status and the library's error code. */
export function describeFailure(status, code) {
  if (status === 401) {
    return 'The API key was not accepted. Make a new one in MindFerry and paste it in.';
  }
  if (status === 404) {
    return 'The library is not turned on for this server, or the address is wrong.';
  }
  if (status === 429) {
    return 'Too many saves in a short time. Wait a minute and try again.';
  }
  if (code === 'unsafe_url') {
    return 'MindFerry cannot fetch that address.';
  }
  if (code === 'not_readable') {
    return 'No readable article was found on that page.';
  }
  if (status === 413 || code === 'too_large') {
    return 'That page is too large to save.';
  }
  return `Could not save the page (error ${status}).`;
}

/** Saves a page and says what happened: `{ ok: true, created }` or `{ ok: false, message }`. */
export async function saveClip({ fetchImpl, server, apiKey, url, html }) {
  if (!isSavableUrl(url)) {
    return { ok: false, message: 'Only web pages can be saved.' };
  }
  const request = buildClipRequest({ server, apiKey, url, html });
  let response;
  try {
    response = await fetchImpl(request.url, request.init);
  } catch {
    return {
      ok: false,
      message: 'Could not reach the server. Check the address and your connection.',
    };
  }
  if (response.ok) {
    const data = await response.json().catch(() => ({}));
    return { ok: true, created: response.status === 201, title: data?.document?.title };
  }
  const data = await response.json().catch(() => ({}));
  return { ok: false, message: describeFailure(response.status, data?.error?.code) };
}
