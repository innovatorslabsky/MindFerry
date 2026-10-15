# Reading library

Save articles, PDFs and EPUBs, highlight them, and pick up where you left off. An assistant
connected to the Context Hub can search and read what you saved. Off by default.

```yaml
contextHub:
  library:
    enabled: true     # the library API; the MCP tools also need contextHub.mcp.enabled
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
- **Parsing runs in the API process**, bounded by size, page, time and (for URLs) SSRF limits. It is
  not isolated in a worker.
- **Feeds are not subscribed to.** There is no polling schedule yet.
- **Pages that need JavaScript** to render cannot be fetched by URL; save them from the browser with
  `{ url, html }` instead.
- The PDF text layer contract (the client must reproduce `text` from pdf.js spans) has been checked
  on the server only, not in a real browser.
- Saving by URL stores third-party text for the user. Take legal advice before offering that
  publicly.
