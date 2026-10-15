# Reading library

Save articles, PDFs and EPUBs, highlight them, and pick up where you left off. An assistant
connected to the Context Hub can search and read what you saved. Off by default.

```yaml
contextHub:
  library:
    enabled: true     # the library API; the MCP tools also need contextHub.mcp.enabled
    isolation:        # all optional; these are the defaults
      mode: process   # or "inline" (single trusted user only, see below)
      maxConcurrent: 2
      maxQueue: 16
      timeoutMs: 60000
      memoryMb: 768
```

## What you can save

| Source | How | Stored as |
| --- | --- | --- |
| A web page | `POST /api/library/documents` with `{ url }` — the server fetches it | one text (`kind: article`) |
| A page you already have open | the same call with `{ url, html }` — no fetch happens | one text |
| A PDF or EPUB | `POST /api/library/uploads`, multipart field `file`, up to 50 MiB | one **unit** per page (PDF) or chapter (EPUB), `kind: pdf` / `epub` |
| An RSS, Atom or JSON feed | `POST /api/library/feeds/preview` with `{ url }` | **nothing** — it lists items; save the ones you want by URL |

The file type is decided from the bytes, never the file name or declared type. The uploaded file is
not kept: its text, chapters and table of contents are.

An upload's identity is its bytes. Uploading the same file twice is one document; a revised copy is a
different document (its highlights do not carry over).

## Highlights

A highlight stores what was selected plus the text around it (the W3C TextQuote idea), not just
offsets. When a saved page's text changes, its highlights are re-placed; one that cannot be placed is
kept and flagged `orphaned` rather than deleted, and is retried on the next save.

Each coordinate space is separate:

- an article: the text of the sanitized `contentHtml`;
- an EPUB chapter: the text of that chapter's `contentHtml`;
- a PDF page: the page's text items joined with nothing between them (`text`). The page also has a
  reflowed `readableText` for reading and search. **A client must build its selection offsets from
  the first, not the second.**

## Known limits

- **Images in EPUBs are not served.** Chapter HTML carries `data-epub-resource` markers where images
  were; the image bytes are not stored yet.
- **Scanned PDFs** (`needsOcr: true`) have almost no text and are not searchable. There is no OCR.
- **Multi-column PDFs** read in content-stream order, which can interleave columns.
- **PDFs that forbid copying** are read like any other. Whether to honour that flag is undecided.
- **Network isolation is the deployment's job.** The parser process cannot read your files, secrets or
  database, but it shares the host's network. URL fetches are guarded in code (public addresses only,
  checked when the socket connects and again on every redirect); for defence in depth, give the API
  container an egress policy that blocks private ranges and cloud metadata addresses.
- **Feeds are not subscribed to.** There is no polling schedule yet.
- **Pages that need JavaScript** to render cannot be fetched by URL; save them from the browser with
  `{ url, html }` instead.
- The PDF text layer contract (the client must reproduce `text` from pdf.js spans) has been checked
  on the server only, not in a real browser.
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
