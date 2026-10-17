import { createHash } from 'node:crypto';
import type { LibraryBookInput, LibraryTocRecord } from '@librechat/data-schemas';
import type { UploadDraft } from './ingest/upload';
import type { EpubDraft } from './epub/parseEpub';
import type { PdfDraft } from './pdf/parsePdf';

/** Search text kept on the document row. A book's full text lives in its units. */
export const BOOK_SEARCH_TEXT_CHARS = 100_000;

const UNTITLED = 'Untitled';

/**
 * An uploaded file's identity is its bytes: the same file uploaded twice is one document, and a
 * revised copy is a different one. (A URL has a stable address; a file does not.)
 */
export function uploadKey(bytes: Uint8Array): { urlKey: string; normalizedUrl: string } {
  const fileHash = createHash('sha256').update(bytes).digest('hex');
  return {
    urlKey: createHash('sha256').update(`upload:${fileHash}`).digest('hex'),
    normalizedUrl: `upload://${fileHash}`,
  };
}

function tocFromPdf(draft: PdfDraft): LibraryTocRecord[] {
  return draft.toc.map((entry) => ({
    title: entry.title,
    depth: entry.depth,
    ...(entry.pageIndex === null ? {} : { unitIndex: entry.pageIndex }),
  }));
}

function tocFromEpub(draft: EpubDraft): LibraryTocRecord[] {
  return draft.toc.map((entry) => ({
    title: entry.title,
    depth: entry.depth,
    ...(entry.chapterIndex === null ? {} : { unitIndex: entry.chapterIndex }),
    ...(entry.fragment === null ? {} : { fragment: entry.fragment }),
  }));
}

function pdfToBook(
  key: ReturnType<typeof uploadKey>,
  draft: PdfDraft,
  now: Date,
): LibraryBookInput {
  const readable = draft.pages.map((page) => page.text).join('\n\n');
  return {
    ...key,
    kind: 'pdf',
    title: draft.title.trim() || UNTITLED,
    byline: draft.author ?? undefined,
    publishedTime: draft.createdAt ?? undefined,
    contentHtml: '',
    text: readable.slice(0, BOOK_SEARCH_TEXT_CHARS),
    contentHash: draft.contentHash,
    wordCount: draft.wordCount,
    readingMinutes: draft.readingMinutes,
    toc: tocFromPdf(draft),
    needsOcr: draft.needsOcr,
    truncated: draft.truncated,
    fetchedAt: now,
    units: draft.pages.map((page) => ({
      index: page.index,
      kind: 'page',
      // The reflowed text is what the reader shows, so it is also where highlights are anchored: the
      // browser can reproduce exactly this string, which it could not do for the raw text items.
      text: page.text,
      wordCount: page.wordCount,
      contentHash: createHash('sha256').update(page.text).digest('hex'),
    })),
  };
}

function epubToBook(
  key: ReturnType<typeof uploadKey>,
  draft: EpubDraft,
  now: Date,
): LibraryBookInput {
  const text = draft.chapters.map((chapter) => chapter.text).join('\n\n');
  return {
    ...key,
    kind: 'epub',
    title: draft.title.trim() || UNTITLED,
    byline: draft.authors.length > 0 ? draft.authors.join(', ') : undefined,
    siteName: draft.publisher ?? undefined,
    lang: draft.language ?? undefined,
    publishedTime: draft.publishedAt ?? undefined,
    contentHtml: '',
    text: text.slice(0, BOOK_SEARCH_TEXT_CHARS),
    contentHash: draft.contentHash,
    wordCount: draft.wordCount,
    readingMinutes: draft.readingMinutes,
    toc: tocFromEpub(draft),
    resources: draft.resources.map(({ path, mediaType, bytes }) => ({ path, mediaType, bytes })),
    fetchedAt: now,
    units: draft.chapters.map((chapter) => ({
      index: chapter.index,
      kind: 'chapter',
      title: chapter.title || undefined,
      contentHtml: chapter.contentHtml,
      text: chapter.text,
      wordCount: chapter.wordCount,
      contentHash: chapter.contentHash,
    })),
  };
}

/** Maps a parsed upload onto what the library stores. */
export function uploadToBook(
  bytes: Uint8Array,
  upload: UploadDraft,
  now: Date = new Date(),
): LibraryBookInput {
  const key = uploadKey(bytes);
  return upload.kind === 'pdf'
    ? pdfToBook(key, upload.draft, now)
    : epubToBook(key, upload.draft, now);
}
