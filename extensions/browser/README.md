# MindFerry Library browser extension

Saves the page you are on to your MindFerry library, from the toolbar button or by right-clicking a
link. It works in Chrome, Edge, Brave and Firefox (128 or later).

## Install it

1. Open `chrome://extensions` (or `about:debugging#/runtime/this-firefox` in Firefox), turn on
   developer mode and choose **Load unpacked** (Firefox: **Load Temporary Add-on**) and pick this folder.
2. In MindFerry, make an API key: Settings → API Keys → Agent API Keys.
3. Click the extension, open **Server and key**, enter your MindFerry address and the key, and
   allow access to that server when the browser asks.

The key is kept in the browser's local extension storage on this device only and is sent only to
your server.

## What it sends

- **Save this page** sends the address and the HTML the browser holds, so pages behind a login and
  pages built in the browser save too. A page over 2,000,000 characters is sent as a link instead,
  and the server fetches it.
- **Save link to MindFerry** (right-click a link) sends only the address; the server fetches it.

Both go to `POST /api/library/clip` with `Authorization: Bearer <key>`. The server cleans the page
and stores the text; scripts and styles are dropped.

## Tests

```sh
node --test extensions/browser/__tests__/*.test.mjs
```
