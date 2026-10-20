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
- on a wide screen the **Inbox / Later / Archive / Feed** buttons and the type filter (All, Articles,
  PDF, EPUB) form a column to the left of the list; on a narrow one they sit above it. A **Sort by**
  menu orders the list by recent change, date saved, title, or shortest or longest to read. Typing in
  the search box searches the title and text of everything instead; each row can be moved or deleted;
- the reader has an **Info** and a **Notebook** tab beside the text. Notebook holds a note of your own
  for the document (saved when you click away, up to 5,000 characters) above the highlights. Info
  holds a short summary you write (up to 2,000 characters), the document's details (type, site, author,
  published date, length, when you saved it, a link to the source) and **Edit metadata**, which changes
  the title and the author. A title or author you changed is kept when the same page is saved again.
  There is no automatic summary: nothing writes one for you yet;
- an article with two or more headings shows them as a **Contents** column to the left of the text,
  and choosing one scrolls there. Books keep their own contents;
- **Pinned views** keep the filters of the list (place, type, tag, folder and sort order) under a name,
  in the column beside it. **Pin this view** asks for a name; pinning again under a name already used
  is refused rather than replacing it. Opening one sets all those filters at once and leaves any search
  behind; the view that matches what is showing is highlighted. They are kept on the server, so they
  follow the person to another device, up to 30 of them. Deleting a folder also removes the views that
  filtered on it. A search is not part of a view, so nothing can be pinned while one is typed;
- each row shows a small picture, the type, the site or author, the length and the first two lines of
  the text. The picture is an EPUB's cover, or an article's lead image (`og:image`); a PDF, or a page
  with no usable image, shows an icon for its type. Documents saved before this was added have no
  opening lines until they are saved again (or, for a scanned PDF, read with OCR);
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
  is drawn from the stored file in the browser (pdf.js). Select words on the page to highlight them
  there; they show on the page image and in the text view alike (see "Highlighting on the page
  image"). **Remove original file** deletes the stored copy and keeps the text, pages and highlights.

If the text the browser shows ever differs from
the text the server anchored highlights in, highlighting is switched off for that text with a notice,
rather than saving highlights in the wrong place.

## Keyboard and selecting several documents

In the list, with no field focused:

| Key       | Does                                       |
| --------- | ------------------------------------------ |
| `j` / `k` | move down / up the list                    |
| `o`       | open the document                          |
| `x`       | select or unselect it                      |
| `e`       | archive it (`l` read later, `i` Inbox)     |
| `#`       | delete it (asks first)                     |
| `/`       | go to the search box                       |
| `?`       | show this list; `Esc` clears the selection |

In the reader: `h` highlights the selected text (yellow), `e` archives and goes back, `l` sets the
document aside, `u` goes back, and `n` / `p` go to the next / previous chapter or page. Shortcuts
never act while you type in a field and never with Ctrl, Cmd or Alt held.

The checkboxes (or **Select all**) turn the list into a batch: move the selected documents to
Inbox, Later or Archive, file them into a folder, or delete them (asks first, saying how many). A
document that cannot be changed is counted; the others still go through.

## Daily review

**Daily review** (button above the list, `/library/review`) shows a few old highlights, one card at a
time, so what you marked comes back. **Next** (`d` or →) counts it as seen today; **Don't show
again** (`m`) keeps it out of every later review. Highlights not seen for longest come first, never
seen ones before all; ones that could not be found again after a page changed are left out. A day's
review is `contextHub.library.reviewPerDay` highlights (default 5) and **Review 5 more** carries on.
"Today" follows the browser's timezone.

## Ask about this

**Ask about this** in the reader opens a new MindFerry chat that starts from the document: an
article's text, or for a book the current page or chapter (**Ask about the whole book** takes the
book from its start). Your highlights and notes are listed with it. The chat runs on the endpoint
and model of the chat you last had open, or the deployment's default; you then keep chatting as in
any conversation. The text is put in front of the model behind a notice that it is third-party content,
cut at `contextHub.library.chatMaxChars` characters (default 60,000; the chat says when it was cut),
and goes through the same content filters and size limits as an import.

## Ask your library

**Ask your library** (button above the list, `/library/ask`) opens a chat about the whole library
instead of one document. It says how many documents you have, and you pick what to do:

- **Find**, **Learn** and **Research** take a topic. The best matches are found with the library
  search; Find lists up to 10 with their summaries, Learn reads the top 3 in full, Research reads
  the top 6 and compares them.
- **Catch up** lists the 8 documents you saved last. **Recommend** lists up to 12 from your inbox and
  later list (never the archive) with your latest highlights, and suggests what to read next.

The documents are picked once, when the chat is created, and put in front of the model behind the
same third-party notice as "Ask about this". The text is shared out under
`contextHub.library.chatMaxChars`, so reading more documents means less of each. The chat runs on
the endpoint and model of the chat you last had open. Follow-up questions are about those documents:
the chat does not search the library again, so start a new one to look at something else.

## Summaries written by a model

**Summarize with AI** in the Info panel asks a model for a short summary of the document: 3 to 5
sentences in the document's own language. The summary is a draft: it replaces nothing until you press
**Keep summary**, and you can edit it first or discard it. A summary you keep is the same field you can
type into, and it is listed with the document in "Ask about this" and "Ask your library".

Which model writes it, and who pays, depends on the deployment:

- **Your own model (the default).** It runs on the endpoint and model of the chat you last had open
  (or the last chat setup the app stored, if you opened the library directly), with your own
  credentials. If there is none, it asks you to open a chat first; agent and assistant chats cannot be
  used. The call is recorded as spending against your balance (context `library-summary`) when balances
  are on, and a person with no credits left is turned away before the call. There is no reservation, so
  one call can overdraw by the cost of one summary.
- **The deployment's model.** An operator can name a model it pays for:

  ```yaml
  contextHub:
    library:
      summary:
        endpoint: Company # an endpoint already configured in this file, or a built-in one
        model: small-model # the model on it
        perUserPerDay: 30 # default 30, from 1 to 1000
  ```

  Then every summary runs on that model, whatever chat anyone has open, and costs the person nothing:
  it is not spent against their balance and does not need credits. Each person gets `perUserPerDay`
  summaries a day; the count is kept in the API process, so it is per replica and starts over on a
  restart, and a person on their own model is not counted. The endpoint's own credentials are used
  (if it is `user_provided`, the person's key for it).

- The text goes to the model the same way as in "Ask about this": behind the third-party notice, cut at
  `contextHub.library.chatMaxChars` (the prompt says so when it was cut), and a book is read from its
  start, so its summary reflects the first part.
- The route (`POST /api/library/documents/:id/summary`) shares the stricter save rate limit, returns the
  draft without saving it, and answers `400 model_required`, `402 insufficient_balance`,
  `422 model_unavailable`, `429 summary_limit` or `502 model_failed` (a failure reported without the
  provider's message).

## Highlighting on the page image

With the original PDF kept, the words of the page are laid invisibly over the page image. Selecting
words there finds the same words in the stored page text, where highlights live, so a highlight made
on the image appears in the text view and the other way round. Line breaks and hyphens at the end of
a line do not matter. A passage that appears twice on a page is told apart by which one it is. If a
selection cannot be matched, it says so and nothing is saved; try a smaller piece.

## Saving from the browser

The extension in `extensions/browser/` saves the page you are on (the toolbar button) or a link
(right-click). It sends the page's HTML, so pages behind a login save too, to
`POST /api/library/clip` with `Authorization: Bearer <Agent API key>` (Settings → API Keys). The
body is the same as saving a page; the key can do nothing else here. See `extensions/browser/README.md`
for loading it.

## Newsletters by email

In the **Feed** tab, **Get a newsletter address** makes a private address like
`https://your-host/api/library/inbox/<secret>`. Point an email service's incoming-mail webhook at it
and each message becomes a document in the Feed tab, tagged `newsletter`, named for its subject and
sender. The secret is shown once, when it is made: only a hash is stored. **Make a new address**
replaces it and the old one stops working at once; **Turn off** removes it.

MindFerry does not receive email itself. It accepts a `POST` with JSON, URL-encoded or multipart
fields, reading `from`, `subject`, `html`, `text`, `messageId` and `date`, plus the names Postmark
(`From`, `HtmlBody`, `TextBody`, `MessageID`) and Mailgun (`sender`, `body-html`, `body-plain`,
`Message-Id`) use. For Cloudflare Email Routing, a worker can forward a message:

```js
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).text();
    await fetch(env.MINDFERRY_ADDRESS, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: message.from,
        subject: message.headers.get('subject'),
        text: raw,
      }),
    });
  },
};
```

(That sends the raw message as text; use an email parser in the worker to send `html` for the best
result.) The same message delivered twice is one document, found by `messageId`. A message with no
HTML falls back to its text, and one with neither is refused. Attachments are ignored. Anyone who has
the address can add documents to your Feed tab and nothing else; guesses are rate limited by IP.

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

## Exporting highlights

**Export highlights** (Markdown or CSV) sits above the library list for everything, and under the
highlights panel in the reader for the open document (`GET /api/library/export?format=markdown|csv`,
add `&documentId=<id>` for one document). Up to 10,000 highlights per file.

- Markdown has a heading per document with its author, site and address, then each highlight as a
  quote with its note, colour, page or chapter, tags and date. A highlight whose text can no longer be
  found on its page is kept and marked.
- CSV has one row per highlight (`Highlight, Title, Author, Source, URL, Note, Color, Tags, Location,
Date, Not found`), with a byte order mark so Excel reads Vietnamese and CJK text correctly.
- Highlights are text from web pages and from the person's own notes, so exports are made safe to open:
  a CSV cell that a spreadsheet would run as a formula (starting with `=`, `+`, `-`, `@`, a tab or a
  carriage return) gets a leading apostrophe, and a multi-line quote cannot leave its Markdown block.
  A legitimate cell beginning with a dash therefore shows an apostrophe in a spreadsheet.
- The download carries `nosniff`, a sandbox policy and `no-store`, and its file name is plain ASCII.
- The chat assistant does not need the export: the library's MCP tools (`search_library`,
  `get_document`, `list_highlights`) already let it read highlights directly.

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

## Settings

```yaml
contextHub:
  library:
    enabled: true
    keepPdfOriginals: true # page image, OCR and highlighting on the image
    autoTag: true
    reviewPerDay: 5 # highlights in one day's review (1 to 100)
    chatMaxChars: 60000 # most text "Ask about this" gives the model (2,000 to 400,000)
```

## Known limits

- **EPUB images** are stored with the book (raster formats only, typed from their bytes; at most 40 MiB
  per book, and a larger picture or one over the budget is left out) and served from
  `GET /api/library/documents/:id/resources?path=`. The reader fetches each with the session's
  credentials, because an `<img src>` cannot send them, and shows it from an object URL. SVG, fonts
  and the book's own CSS are not kept.
- **Article pictures** are fetched by the server when the page is saved, through the same guarded
  fetch as the page itself (public addresses only, 5 seconds, at most 300 KB, typed from the first
  bytes; nothing is decoded or resized). A larger picture, or one that cannot be fetched, is skipped
  and the page is saved without one. A newsletter's lead image is never fetched, since it is often a
  tracking pixel. Pictures are served like EPUB images, to their owner only. They are not made smaller,
  so a 300 KB picture is shown at thumbnail size. A PDF has no picture; drawing its first page needs
  the original file and is not done.
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
- **The daily review, "Ask about this" and "Ask your library" read what is stored**: a highlight whose page changed and
  could not be found again is left out of the review, and a scanned page with no text yet has nothing
  to ask about until it has been read with OCR.
- **Newsletter images** load from the sender's server when you read, as they would in any mail
  program, which can tell the sender that you read it.
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
