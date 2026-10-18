import { isSavableUrl, saveClip } from './clip.js';

const MENU_ID = 'mindferry-save-link';

async function settings() {
  const { server, apiKey } = await chrome.storage.local.get(['server', 'apiKey']);
  return { server, apiKey };
}

async function notify(message) {
  await chrome.action.setBadgeText({ text: message ? '!' : '✓' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
}

/** Saves a link from the page's own context menu; the server fetches it, nothing is read from the tab. */
async function saveLink(url) {
  const { server, apiKey } = await settings();
  if (!server || !apiKey || !isSavableUrl(url)) {
    await notify('setup');
    return;
  }
  const result = await saveClip({ fetchImpl: fetch, server, apiKey, url });
  await notify(result.ok ? '' : result.message);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Save link to MindFerry',
    contexts: ['link'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_ID && info.linkUrl) {
    saveLink(info.linkUrl);
  }
});
