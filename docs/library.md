# Reading library

Save articles, PDFs and EPUBs, highlight them, and pick up where you left off. An assistant
connected to the Context Hub can search and read what you saved. Off by default.

```yaml
contextHub:
  library:
    enabled: true # the library API; the MCP tools also need contextHub.mcp.enabled
    isolation: # all optional; these are the defaults
      mode: process # or "inline" (single trusted user only, see below)
      maxConcurrent: 2
      maxQueue: 16
      timeoutMs: 60000
      memoryMb: 768
```

## Using it

With `contextHub.library.enabled: true` a Library entry appears in the sidebar (and in the mobile
drawer), leading to `/library`:

- paste an article address and press **Save**, or **Upload PDF or EPUB**;
- the **Inbox / Later / Archive / Feed** buttons filter the list; typing in the search box searches the
  title and text of everything instead; each row can be moved or deleted;
- opening an article shows it cleanly with a **Highlights** panel beside it. Select text and pick a
  colour to highlight it; add a note under a highlight; delete it from the panel. Highlights stay put
  after reloading, and if a saved page is saved again with different text they are moved, or marked
  as not found, never lost;
- the reader remembers where you stopped (a text position, not a scroll distance) and returns there;
- an EPUB shows its contents and its pictures and is read a chapter at a time; a PDF is read a page at
  a time as reflowed text; both keep their highlights per chapter or page;
- on a narrow screen the contents and the highlights open as a sheet over the text from buttons in the
  header, instead of as side columns.

- every new document is tagged automatically with the site it came from (`example.com`), `pdf` or
  `epub` for a book, and up to three keywords (see "Automatic tags" below);
- a **folder** menu above the list filters by folder (all, unfiled, or one folder, with counts). The
  new-folder button makes one, the pencil renames it, the bin deletes it (its documents stay, in no
  folder). Each row has a menu to move it into a folder;
- tags are edited under the reader's header (Enter adds, × removes); clicking a tag on a list row
  shows only documents with it;
- the **Feed** tab holds the feeds you follow. Paste a feed or site address and press **Follow**: the
  newest 5 items are saved to the tab. **Check** on a feed saves up to 10 items it has not shown you
  before. Nothing is checked in the background; an item that cannot be read is counted and not retried.
  You can follow up to 50 feeds.

- a PDF uploaded while `keepPdfOriginals` is on can be switched from **Text** to **Page**: the page
  is drawn from the stored file in the browser (pdf.js, pixels only). Highlights are made in the text
  view. **Remove original file** deletes the stored copy and keeps the text, pages and highlights.

If the text the browser shows ever differs from
the text the server anchored highlights in, highlighting is switched off for that text with a notice,
rather than saving highlights in the wrong place.

## What you can save

| Source                       | How                                                                                               | Stored as                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A web page                   | `POST /api/library/documents` with `{ url }` — the server fetches it                              | one text (`kind: article`)                                          |
| A page you already have open | the same call with `{ url, html }` — no fetch happens                                             | one text                                                            |
| A PDF or EPUB                | `POST /api/library/uploads`, multipart field `file`, up to 50 MiB                                 | one **unit** per page (PDF) or chapter (EPUB), `kind: pdf` / `epub` |
| An RSS, Atom or JSON feed    | `POST /api/library/feeds/preview` with `{ url }`                                                  | **nothing** — it lists items; save the ones you want by URL         |
| A feed you follow            | `POST /api/library/feeds` `{ url }`; `GET /feeds`; `POST /feeds/:id/refresh`; `DELETE /feeds/:id` | each item as an article in the Feed tab (`location: feed`)          |

The file type is decided from the bytes, never the file name or declared type. The uploaded file is
not kept: its text, chapters and table of contents are. The one exception is opt-in: with
`contextHub.library.keepPdfOriginals: true` the original of each uploaded **PDF** is kept as well
(see below). An EPUB's original is never kept.

An upload's identity is its bytes. Uploading the same file twice is one document; a revised copy is a
different document (its highlights do not carry over).

## Highlights

A highlight stores what was selected plus the text around it (the W3C TextQuote idea), not just
offsets. When a saved page's text changes, its highlights are re-placed; one that cannot be placed is
kept and flagged `orphaned` rather than deleted, and is retried on the next save.

Each coordinate space is separate:

- an article: the text of the sanitized `contentHtml`;
- an EPUB chapter: the text of that chapter's `contentHtml`;
- a PDF page: the page's reflowed text (lines joined into paragraphs, hyphenation repaired), which is
  exactly what the reader shows. It is shown as one block of preformatted text, so the characters on
  screen are the characters anchored. (The raw text items are not used: they run words together, and a
  browser cannot reproduce them without the PDF.)

A PDF page's anchors therefore mean something only against the reflowed text. If a page image view is
added later it will need its own mapping from the image's text layer to these offsets.

## Automatic tags

A new document gets up to five tags when it is first saved, chosen by counting words on the page, not
by any model, and nothing leaves the server:

- the site (`www.` removed) for a page, or nothing for an uploaded file;
- `pdf` or `epub` for a book;
- up to three keywords: English words of at least four letters that are not common words and appear at
  least three times (a word in the title counts three times). Other languages get the site tag only.

The tags are set once. Saving the same page again, or editing the tags, is never overwritten. Turn it
off with `contextHub.library.autoTag: false` (default on). Scanned PDFs have no text to count, so they get
only `pdf` (reading them with OCR does not add keyword tags afterwards).

## Reading scanned PDFs (OCR)

A scanned PDF has pictures of pages and no text. When the original file is kept
(`keepPdfOriginals: true`), the reader shows a panel for the pages with no text: **Read this page** or
**Read all blank pages**.

- It runs in the person's browser with tesseract.js. The page is drawn from the stored
  original, read, and only the resulting text is sent to the server. Nothing is uploaded to a third
  party: the worker, WebAssembly core and language data are served from `/assets/ocr/` by MindFerry
  itself. The whole folder is about 25 MB in the build, but a browser fetches only the core (about 4 MB)
  and the one language it uses (1 to 3 MB), and only when OCR is started; it then caches them.
- It needs WebAssembly allowed by the page's content security policy: set `CSP_ALLOW_WASM=true`
  (the same switch HEIC conversion uses). Without it the panel says reading failed.
- The text is saved with `PUT /api/library/documents/:id/units/:index/text`. A page accepts it **only
  if it has no text of its own** (fewer than 10 characters), so OCR can never replace text that might
  already be highlighted; a second attempt returns 409. Search text, word count and `needsOcr` for the
  document are refreshed, and the page can then be searched and highlighted like any other.
- A language menu in the panel chooses what to read: English, Tiếng Việt, 简体中文 (Simplified
  Chinese), Français, 한국어, 日本語, Español and Deutsch. It starts from the document's own language when
  it declares one, then the last choice made on that device. One language is read at a time; a page
  mixing scripts reads best in the language of most of its text. Traditional Chinese is not included.
  Spaces OCR inserts between Chinese or Japanese characters are removed when the text is saved.
- Adding a language means adding its `@tesseract.js-data/<code>` package to `client/package.json`, the
  code to `OCR_LANGUAGES` in `client/src/utils/ocr.ts` and to the list in `client/vite.config.ts`.
- Accuracy depends on the scan: a clean 150 dpi page reads well, a skewed or
  photographed one may not. Reading takes seconds per page and uses the person's CPU.
- Without a stored original there is nothing to read from, so a scanned PDF stays text-less.

## Folders

Folders are one level deep, a document is in at most one, and a person can have up to 100
(`GET/POST /api/library/folders`, `PATCH/DELETE /api/library/folders/:id`). File a document with
`PATCH /api/library/documents/:id` and `{ "folderId": "<id>" }` (`null` takes it out); list a folder
with `GET /api/library/documents?folder=<id>` (`folder=none` for unfiled). Folder names are unique per
person ignoring case. Deleting a folder never deletes documents. A document can only be filed into the
person's own folder.

## Keeping original PDFs

```yaml
contextHub:
  library:
    enabled: true
    keepPdfOriginals: true # default false
    autoTag: true # default true
```

Off by default, because it changes what is stored: the whole PDF, not only its text, for every PDF a
user uploads (stored in 8 MB chunks in `LibrarySource`, so up to 50 MiB per file). Read the storage
and privacy implications before switching it on for a shared deployment.

- Only PDFs uploaded after the setting is on have an original. Uploading the same file again adds it
  to one saved earlier. Turning the setting off stops new copies; existing ones stay until removed.
- `GET /api/library/documents/:id/source` returns the file for its owner only (`application/pdf`,
  `nosniff`, `Content-Security-Policy: sandbox`, `no-store`). `DELETE` on the same path removes just the
  original. Deleting the document or the account deletes it too.
- The page is drawn in the browser by pdf.js (the legacy build, for older browsers). Nothing from the
  file is run: only pixels. Reading position is saved from the text view, not the page view.
- The "copy-restricted PDF" flag is still not honoured: a stored original can be viewed and removed
  by its owner, and no export or share feature exists that would need to withhold it.

## Known limits

- **EPUB images** are stored with the book (raster formats only, typed from their bytes; at most 40 MiB
  per book, and a larger picture or one over the budget is left out) and served from
  `GET /api/library/documents/:id/resources?path=`. The reader fetches each with the session's
  credentials, because an `<img src>` cannot send them, and shows it from an object URL. SVG, fonts
  and the book's own CSS are not kept.
- **Highlights on a PDF follow the reflowed text.** A revised PDF is a different document (its key is
  its bytes), so highlights never carry across versions of the same paper.
- **Scanned PDFs** (`needsOcr: true`) have almost no text until they are read with OCR (see above), which
  needs the original file kept and `CSP_ALLOW_WASM=true`.
- **Multi-column PDFs** read in content-stream order, which can interleave columns.
- **PDFs that forbid copying** are read like any other. Whether to honour that flag is undecided.
- **Network isolation is the deployment's job.** The parser process cannot read your files, secrets or
  database, but it shares the host's network. URL fetches are guarded in code (public addresses only,
  checked when the socket connects and again on every redirect); for defence in depth, give the API
  container an egress policy that blocks private ranges and cloud metadata addresses.
- **Feeds are only checked when you ask.** There is no background schedule; a refresh uses the
  feed's ETag / Last-Modified so an unchanged feed costs one cheap request.
- **Pages that need JavaScript** to render cannot be fetched by URL; save them from the browser with
  `{ url, html }` instead.
- Saving by URL stores third-party text for the user. Take legal advice before offering that
  publicly.

## How untrusted input is handled

Every page, PDF, EPUB and feed is parsed by a separate, short-lived Node process, not by the API
process (`isolation.mode: process`, the default). The process:

- gets one job and exits; a hostile input can only affect that one process;
- starts with an empty environment (no database URL, no keys, no tokens), apart from certificate
  locations;
- runs under Node's permission model: it can read the API package and its `node_modules` and nothing
  else, and cannot write files, start processes, start threads or load native addons;
- has a heap ceiling (`memoryMb`) and a hard wall-clock limit (`timeoutMs`), after which it is killed;
- returns plain data, and the API trusts none of it: errors it reports are mapped by name onto a fixed
  list, and anything else becomes a generic failure whose detail goes to the log only.

At most `maxConcurrent` run at once; `maxQueue` more may wait; beyond that a save gets `503 busy`.
Each parse costs about a second of start-up. If the parser program is not built, saving fails with
`503 unavailable` rather than quietly parsing in the API process.

`mode: inline` parses inside the API process, with none of the above, and logs a warning. Use it only
for development or a deployment with a single trusted user.

Known gap: `--disallow-code-generation-from-strings` is not used, because jsdom's selector engine
needs `new Function`. A stand-in `DOMMatrix` is installed in the parser because pdf.js would otherwise
load a native canvas addon, which the sandbox forbids; it refuses to do arithmetic, so a code path that
unexpectedly needed one fails loudly.
