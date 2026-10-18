import { isSavableUrl, normalizeServer, saveClip } from './clip.js';

const $ = (id) => document.getElementById(id);

function say(message, isError = false) {
  const status = $('status');
  status.textContent = message;
  status.className = isError ? 'error' : '';
}

/** The page's HTML as the browser holds it now, so pages behind a login or built in the browser save too. */
async function readPage(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.documentElement.outerHTML,
  });
  return result?.result;
}

async function save() {
  const { server, apiKey } = await chrome.storage.local.get(['server', 'apiKey']);
  if (!server || !apiKey) {
    $('setup').open = true;
    say('Add your MindFerry address and API key first.', true);
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isSavableUrl(tab.url)) {
    say('Only web pages can be saved.', true);
    return;
  }
  $('save').disabled = true;
  say('Saving…');
  try {
    const html = await readPage(tab.id).catch(() => undefined);
    const result = await saveClip({ fetchImpl: fetch, server, apiKey, url: tab.url, html });
    if (result.ok) {
      say(result.created ? 'Saved to your library.' : 'Already in your library; updated.');
    } else {
      say(result.message, true);
    }
  } finally {
    $('save').disabled = false;
  }
}

async function store() {
  const server = normalizeServer($('server').value);
  const apiKey = $('key').value.trim();
  if (!server) {
    say('Enter the address of your MindFerry server, starting with https://.', true);
    return;
  }
  if (!apiKey) {
    say('Paste an API key.', true);
    return;
  }
  const granted = await chrome.permissions.request({ origins: [`${server}/*`] });
  if (!granted) {
    say('The extension needs permission to talk to that server.', true);
    return;
  }
  await chrome.storage.local.set({ server, apiKey });
  $('key').value = '';
  $('setup').open = false;
  say('Settings saved.');
}

async function init() {
  const { server, apiKey } = await chrome.storage.local.get(['server', 'apiKey']);
  if (server) {
    $('server').value = server;
  }
  $('setup').open = !server || !apiKey;
  $('save').addEventListener('click', save);
  $('store').addEventListener('click', store);
}

init();
