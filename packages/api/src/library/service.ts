import { createHash } from 'node:crypto';
import type {
  LibraryDocumentPatch,
  LibraryDocumentRecord,
  LibraryDocumentSummary,
  LibraryFeedRecord,
  LibraryFolderCreateResult,
  LibraryFolderRecord,
  LibraryFolderRenameResult,
  LibraryHighlightInput,
  LibraryHighlightPatch,
  LibraryHighlightRecord,
  LibraryListQuery,
  LibraryLocationValue,
  LibraryMethods,
  LibraryProgressRecord,
  LibraryReanchor,
  LibraryResourceRecord,
  LibraryUnitRecord,
  LibraryUnitSummary,
} from '@librechat/data-schemas';
import type { DocumentDraft } from './ingest/saveDocument';
import type { DailyReview, ReviewAction } from './review';
import type { FeedFetchResult } from './feed/fetchFeed';
import type { LibraryIngest } from './worker/ingest';
import type { FetchedImage } from './ingest/image';
import type { ExportFormat } from './export';
import type { InboundEmail } from './inbox';
import type { ChatSource } from './chat';
import { EXPORT_MAX_HIGHLIGHTS, highlightsToCsv, highlightsToMarkdown } from './export';
import { emailKey, generateInboxToken, hashInboxToken, textToHtml } from './inbox';
import { DEFAULT_REVIEW_PER_DAY, MAX_REVIEW_EXTRA, startOfDay } from './review';
import { createAnchor, resolveAnchor } from './anchor/textQuote';
import { fetchFeed, subscribeToUrl } from './feed/fetchFeed';
import { saveHtml, saveUrl } from './ingest/saveDocument';
import { DEFAULT_CHAT_MAX_CHARS, capText } from './chat';
import { NotReadableError } from './ingest/extract';
import { fetchThumbnail } from './ingest/image';
import { urlKey } from './ingest/normalizeUrl';
import { ingestUpload } from './ingest/upload';
import { feedItemKey } from './feed/parseFeed';
import { totalWords } from './ingest/extract';
import { suggestTags } from './autotag';
import { uploadToBook } from './book';

type Methods = Pick<
  LibraryMethods,
  | 'saveLibraryDocument'
  | 'saveLibraryBook'
  | 'addLibraryFeed'
  | 'listLibraryFeeds'
  | 'getLibraryFeed'
  | 'recordLibraryFeedRefresh'
  | 'deleteLibraryFeed'
  | 'listLibraryUnits'
  | 'getLibraryUnit'
  | 'getLibraryResource'
  | 'setLibraryThumbnail'
  | 'saveLibraryUnitText'
  | 'createLibraryFolder'
  | 'listLibraryFolders'
  | 'renameLibraryFolder'
  | 'deleteLibraryFolder'
  | 'saveLibrarySource'
  | 'getLibrarySource'
  | 'deleteLibrarySource'
  | 'getLibraryDocument'
  | 'listLibraryDocumentsByIds'
  | 'listLibraryDocuments'
  | 'searchLibraryDocuments'
  | 'updateLibraryDocument'
  | 'deleteLibraryDocument'
  | 'createLibraryHighlight'
  | 'listLibraryHighlights'
  | 'updateLibraryHighlight'
  | 'deleteLibraryHighlight'
  | 'rotateLibraryInbox'
  | 'getLibraryInbox'
  | 'deleteLibraryInbox'
  | 'findLibraryInboxOwner'
  | 'listLibraryReviewHighlights'
  | 'countLibraryReviewedSince'
  | 'markLibraryHighlightReviewed'
  | 'reanchorLibraryHighlights'
  | 'getLibraryProgress'
  | 'setLibraryProgress'
>;

export interface LibraryServiceDeps {
  methods: Methods;
  /**
   * How untrusted input is parsed. Defaults to parsing in this process; production passes an
   * isolated one (`createIsolatedIngest`) so a hostile page or file can only hurt a short-lived,
   * restricted child process.
   */
  ingest?: Partial<LibraryIngest>;
  /** Fetches the lead image of a saved page for lists. Defaults to a guarded fetch of the address. */
  fetchImage?: (url: string) => Promise<FetchedImage | null>;
  /** Keep the original file of each uploaded PDF (`contextHub.library.keepPdfOriginals`). */
  keepPdfOriginals?: boolean;
  /** Tag each new document with its site and keywords (default on). */
  autoTag?: boolean;
  /** Highlights in one day's review (`contextHub.library.reviewPerDay`). */
  reviewPerDay?: number;
  /** The most text "Ask about this" puts in front of the model (`contextHub.library.chatMaxChars`). */
  chatMaxChars?: number;
  /** Read for the day's start; tests pass a fixed one. */
  now?: () => Date;
}

export interface SaveResult {
  document: LibraryDocumentSummary;
  created: boolean;
  /** Only meaningful when the page was saved before and its text changed. */
  reanchored: { kept: number; orphaned: number };
}

export interface UploadResult {
  document: LibraryDocumentSummary;
  created: boolean;
}

/** What a feed holds, for the person to choose from. Nothing is stored. */
export interface FeedPreview {
  title: string;
  siteUrl: string | null;
  feedUrl: string;
  description: string | null;
  items: Array<{
    guid: string;
    url: string | null;
    title: string;
    author: string | null;
    publishedAt: string | null;
    summary: string | null;
  }>;
}

/** What a refresh did. Items the feed no longer lists, or that were already seen, do not appear here. */
export interface FeedRefreshResult {
  /** New items saved to the library's Feed tab. */
  added: number;
  /** New items that could not be fetched or read; they are not retried. */
  failed: number;
  /** New items past the per-refresh cap, or with no address to save. */
  skipped: number;
  /** The feed said nothing had changed since the last refresh. */
  notModified: boolean;
}

export type FollowFeedOutcome =
  | { status: 'followed'; feed: LibraryFeedRecord; refresh: FeedRefreshResult }
  | { status: 'exists'; feed: LibraryFeedRecord }
  | { status: 'limit' };

export type CreateHighlightOutcome =
  | { status: 'created'; highlight: LibraryHighlightRecord }
  | { status: 'not_found' }
  /** The client selected text in a version of the page the server no longer holds. */
  | { status: 'stale' }
  /** `anchor.exact` is not what the stored text says is at [start, end). */
  | { status: 'mismatch' };

export interface LibraryService {
  saveFromUrl: (
    userId: string,
    url: string,
    location?: LibraryLocationValue,
  ) => Promise<SaveResult>;
  /** For a client that already holds the rendered page: no server-side fetch happens. */
  saveFromHtml: (
    userId: string,
    url: string,
    html: string,
    location?: LibraryLocationValue,
  ) => Promise<SaveResult>;
  /** A PDF or EPUB the person uploaded. The type is decided from the bytes, not the file name. */
  saveUpload: (
    userId: string,
    bytes: Uint8Array,
    location?: LibraryLocationValue,
  ) => Promise<UploadResult>;
  previewFeed: (url: string) => Promise<FeedPreview>;
  /** Follows a feed (or the feed a site advertises) and saves its latest few items to the Feed tab. */
  followFeed: (userId: string, url: string) => Promise<FollowFeedOutcome>;
  listFeeds: (userId: string) => Promise<LibraryFeedRecord[]>;
  /** Saves the items that are new since the last refresh. `null` when the feed is not the user's. */
  refreshFeed: (userId: string, id: string) => Promise<FeedRefreshResult | null>;
  unfollowFeed: (userId: string, id: string) => Promise<boolean>;
  listUnits: (userId: string, documentId: string) => Promise<LibraryUnitSummary[]>;
  /** One image of a book the person saved. */
  getResource: (
    userId: string,
    documentId: string,
    path: string,
  ) => Promise<LibraryResourceRecord | null>;
  /** The original file of a PDF, when the operator keeps them and the person's copy has one. */
  getSource: (userId: string, documentId: string) => Promise<Buffer | null>;
  /** Drops the stored original of a PDF, keeping its text, pages and highlights. */
  removeSource: (userId: string, documentId: string) => Promise<boolean>;
  getUnit: (userId: string, documentId: string, index: number) => Promise<LibraryUnitRecord | null>;
  list: (userId: string, query: LibraryListQuery) => Promise<LibraryDocumentSummary[]>;
  search: (userId: string, query: string, limit: number) => Promise<LibraryDocumentSummary[]>;
  get: (userId: string, id: string) => Promise<LibraryDocumentRecord | null>;
  update: (
    userId: string,
    id: string,
    patch: LibraryDocumentPatch,
  ) => Promise<LibraryDocumentSummary | null>;
  remove: (userId: string, id: string) => Promise<boolean>;
  /**
   * Stores text read from the image of a scanned PDF page by the person's browser. Only a page that
   * has no text of its own is filled in, so nothing already highlighted can be replaced.
   */
  saveUnitText: (
    userId: string,
    documentId: string,
    index: number,
    text: string,
  ) => Promise<SaveUnitTextOutcome>;
  /**
   * The person's highlights as a file, for one document or for everything. `null` when a named
   * document is not theirs. Never more than `EXPORT_MAX_HIGHLIGHTS`.
   */
  exportHighlights: (
    userId: string,
    format: ExportFormat,
    documentId?: string,
  ) => Promise<HighlightsExport | null>;
  createFolder: (userId: string, name: string) => Promise<LibraryFolderCreateResult>;
  listFolders: (userId: string) => Promise<LibraryFolderRecord[]>;
  renameFolder: (userId: string, id: string, name: string) => Promise<LibraryFolderRenameResult>;
  deleteFolder: (userId: string, id: string) => Promise<boolean>;
  createHighlight: (
    userId: string,
    input: LibraryHighlightInput,
  ) => Promise<CreateHighlightOutcome>;
  listHighlights: (
    userId: string,
    documentId?: string,
    limit?: number,
  ) => Promise<LibraryHighlightRecord[]>;
  updateHighlight: (
    userId: string,
    id: string,
    patch: LibraryHighlightPatch,
  ) => Promise<LibraryHighlightRecord | null>;
  removeHighlight: (userId: string, id: string) => Promise<boolean>;
  /**
   * Today's review: highlights not seen yet today, up to the day's goal. `extra` raises the goal for
   * a person who wants to keep going; `offsetMinutes` is the browser's timezone offset.
   */
  dailyReview: (
    userId: string,
    options?: { offsetMinutes?: number; extra?: number },
  ) => Promise<DailyReview>;
  /**
   * What a chat about a document is opened with: an article's text, one chapter or page of a book when
   * `unitIndex` is given, or the book from its start up to the cap. `null` when it is not the person's.
   */
  chatSource: (
    userId: string,
    id: string,
    options?: { unitIndex?: number },
  ) => Promise<ChatSource | null>;
  /** When the person's newsletter address was made, or `null` if they have none. */
  getInbox: (userId: string) => Promise<{ createdAt: Date } | null>;
  /**
   * Makes the address, or replaces it. The secret in it is returned here and never again: only a hash
   * is kept, so it cannot be read back later.
   */
  rotateInbox: (userId: string) => Promise<{ token: string; createdAt: Date }>;
  deleteInbox: (userId: string) => Promise<boolean>;
  /** Whose address a secret in a request is; `null` if it is no one's. */
  findInboxOwner: (token: string) => Promise<{ userId: string; tenantId?: string } | null>;
  /** Saves a newsletter to the person's Feed tab. The same message again updates the same document. */
  receiveEmail: (userId: string, email: InboundEmail) => Promise<SaveResult>;
  /** `false` when the highlight is not the person's. */
  reviewHighlight: (userId: string, id: string, action: ReviewAction) => Promise<boolean>;
  getProgress: (userId: string, documentId: string) => Promise<LibraryProgressRecord | null>;
  setProgress: (
    userId: string,
    documentId: string,
    textOffset: number,
    unitIndex?: number,
  ) => Promise<LibraryProgressRecord | null>;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toSummary(doc: LibraryDocumentRecord): LibraryDocumentSummary {
  const { contentHtml: _html, text: _text, ...summary } = doc;
  return summary;
}

/** Longest OCR text accepted for one page. */
export const MAX_OCR_PAGE_CHARS = 100_000;
/** A page with at least this many characters already has text and is never replaced by OCR. */
export const MIN_PAGE_TEXT_CHARS = 10;

export type SaveUnitTextOutcome =
  | { status: 'saved'; unit: LibraryUnitRecord; needsOcr: boolean }
  | { status: 'not_found' | 'has_text' | 'empty' };

/** Plain text only: no control characters, one kind of line break, no runs of blank lines. */
export function cleanOcrText(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      // OCR puts a space between Chinese and Japanese characters, which are not written with spaces.
      .replace(
        /(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[ \t]+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,
        '',
      )
      .trim()
      .slice(0, MAX_OCR_PAGE_CHARS)
  );
}

export interface HighlightsExport {
  /** ASCII only, so it is safe in a `Content-Disposition` header. */
  filename: string;
  contentType: string;
  body: string;
  count: number;
}

/** A file name stem from a title: lower-case ASCII words, never empty. */
export function filenameStem(title: string): string {
  const stem = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  return stem || 'document';
}

/** Most folders one person may have. */
export const MAX_FOLDERS = 100;
/** Most feeds one person may follow. */
export const MAX_FOLLOWED_FEEDS = 50;
/** Items saved by one refresh. Each is a fetch of a third-party page, so the number is kept small. */
export const MAX_ITEMS_PER_REFRESH = 10;
/** The first refresh, when following, saves only the newest few rather than a feed's whole history. */
export const MAX_ITEMS_ON_FOLLOW = 5;

export function createLibraryService({
  methods,
  ingest = {},
  fetchImage = (url: string) => fetchThumbnail(url),
  keepPdfOriginals = false,
  autoTag = true,
  reviewPerDay = DEFAULT_REVIEW_PER_DAY,
  chatMaxChars = DEFAULT_CHAT_MAX_CHARS,
  now = () => new Date(),
}: LibraryServiceDeps): LibraryService {
  const fetchUrl = ingest.saveUrl ?? ((url: string) => saveUrl(url));
  const fromHtml = ingest.saveHtml ?? (async (url: string, html: string) => saveHtml(url, html));
  const readUpload = ingest.ingestUpload ?? ((bytes: Uint8Array) => ingestUpload(bytes));
  const readFeed = ingest.subscribeToUrl ?? ((url: string) => subscribeToUrl(url));
  const pollFeed =
    ingest.fetchFeed ??
    ((url: string, validators: { etag?: string | null; lastModified?: string | null }) =>
      fetchFeed(url, validators));

  async function persist(
    userId: string,
    draft: DocumentDraft,
    location?: LibraryLocationValue,
    extraTags: string[] = [],
    withThumbnail = true,
  ): Promise<SaveResult> {
    const saved = await methods.saveLibraryDocument(userId, {
      urlKey: draft.urlKey,
      normalizedUrl: draft.normalizedUrl,
      title: draft.title,
      byline: draft.byline ?? undefined,
      siteName: draft.siteName ?? undefined,
      lang: draft.lang ?? undefined,
      publishedTime: draft.publishedTime ?? undefined,
      contentHtml: draft.contentHtml,
      text: draft.text,
      contentHash: draft.contentHash,
      wordCount: draft.wordCount,
      readingMinutes: draft.readingMinutes,
      fetchedAt: new Date(draft.fetchedAt),
      location,
      tags: initialTags(draft, extraTags),
    });
    const reanchored = saved.contentChanged
      ? await reanchor(userId, saved.document)
      : { kept: 0, orphaned: 0 };
    let summary = toSummary(saved.document);
    // A picture only helps a list, so failing to get one never fails the save.
    if (withThumbnail && draft.imageUrl && !summary.thumbnailPath) {
      const image = await fetchImage(draft.imageUrl).catch(() => null);
      if (image && (await methods.setLibraryThumbnail(userId, summary.id, image))) {
        summary = { ...summary, thumbnailPath: '__thumbnail__' };
      }
    }
    return { document: summary, created: saved.created, reanchored };
  }

  function initialTags(draft: DocumentDraft, extraTags: string[]): string[] | undefined {
    const suggested = autoTag
      ? suggestTags({
          kind: 'article',
          title: draft.title,
          text: draft.text,
          lang: draft.lang,
          normalizedUrl: draft.normalizedUrl,
        })
      : [];
    const tags = [...new Set([...extraTags, ...suggested])];
    return tags.length > 0 ? tags : undefined;
  }

  /** Saves the items of a feed read that have not been seen, newest first, and remembers them all. */
  async function saveNewItems(
    userId: string,
    feedId: string,
    result: FeedFetchResult,
    seenKeys: string[],
    cap: number,
  ): Promise<FeedRefreshResult> {
    const outcome: FeedRefreshResult = {
      added: 0,
      failed: 0,
      skipped: 0,
      notModified: result.notModified,
    };
    const feed = result.feed;
    if (!feed) {
      await methods.recordLibraryFeedRefresh(userId, feedId, {
        etag: result.etag,
        lastModified: result.lastModified,
        newKeys: [],
      });
      return outcome;
    }
    const seen = new Set(seenKeys);
    const fresh = feed.items
      .map((item) => ({ item, key: feedItemKey(feed.feedUrl, item.guid) }))
      .filter(({ key }) => !seen.has(key));
    for (const { item } of fresh) {
      if (!item.url || outcome.added + outcome.failed >= cap) {
        outcome.skipped++;
        continue;
      }
      try {
        await persist(userId, await fetchUrl(item.url), 'feed');
        outcome.added++;
      } catch {
        // One unreadable article is not a failed refresh; it is counted, and not tried again.
        outcome.failed++;
      }
    }
    await methods.recordLibraryFeedRefresh(userId, feedId, {
      title: feed.title,
      etag: result.etag,
      lastModified: result.lastModified,
      newKeys: fresh.map(({ key }) => key),
    });
    return outcome;
  }

  /**
   * A page whose text changed keeps its highlights: each is re-resolved against the new text and
   * either moved or flagged as orphaned. Nothing is deleted. Highlights with a `unit` belong to
   * a chapter or page of a book, not this single text, and are left alone.
   */
  async function reanchor(
    userId: string,
    document: LibraryDocumentRecord,
  ): Promise<{ kept: number; orphaned: number }> {
    const highlights = await methods.listLibraryHighlights(userId, document.id);
    const results: LibraryReanchor[] = [];
    for (const highlight of highlights) {
      if (highlight.unit) continue;
      // Already anchored in exactly this text. An orphan is always retried: its stored hash is
      // that of the text it was last placed in, which can be the very text that just came back.
      if (!highlight.orphaned && highlight.contentHash === document.contentHash) continue;
      const match = resolveAnchor(document.text, highlight.anchor);
      results.push({
        id: highlight.id,
        anchor: match ? createAnchor(document.text, match.start, match.end) : null,
        contentHash: document.contentHash,
      });
    }
    await methods.reanchorLibraryHighlights(userId, document.id, results);
    const orphaned = results.filter((result) => result.anchor === null).length;
    return { kept: results.length - orphaned, orphaned };
  }

  return {
    async saveFromUrl(userId: string, url: string, location?: LibraryLocationValue) {
      return persist(userId, await fetchUrl(url), location);
    },

    /** For a client that already holds the rendered page: no server-side fetch happens. */
    async saveFromHtml(userId: string, url: string, html: string, location?: LibraryLocationValue) {
      return persist(userId, await fromHtml(url, html), location);
    },

    async saveUpload(
      userId: string,
      bytes: Uint8Array,
      location?: LibraryLocationValue,
    ): Promise<UploadResult> {
      const book = uploadToBook(bytes, await readUpload(bytes), new Date());
      const tags = autoTag
        ? suggestTags({
            kind: book.kind ?? 'epub',
            title: book.title,
            text: book.text,
            lang: book.lang,
            normalizedUrl: book.normalizedUrl,
          })
        : undefined;
      const saved = await methods.saveLibraryBook(userId, { ...book, location, tags });
      let document = toSummary(saved.document);
      // The same file uploaded again keeps the copy it already has.
      if (keepPdfOriginals && book.kind === 'pdf' && !document.hasSource) {
        const kept = await methods.saveLibrarySource(userId, document.id, bytes);
        document = { ...document, hasSource: kept };
      }
      return { document, created: saved.created };
    },

    async previewFeed(url: string): Promise<FeedPreview> {
      const result: FeedFetchResult = await readFeed(url);
      const feed = result.feed;
      if (!feed) {
        throw new Error('The feed did not return any content');
      }
      return {
        title: feed.title,
        siteUrl: feed.siteUrl,
        feedUrl: feed.feedUrl,
        description: feed.description,
        items: feed.items.map((item) => ({
          guid: item.guid,
          url: item.url,
          title: item.title,
          author: item.author,
          publishedAt: item.publishedAt,
          // Feed summaries are sanitized HTML; the list only needs the words.
          summary: item.summaryHtml ? stripTags(item.summaryHtml).slice(0, 400) : null,
        })),
      };
    },

    async followFeed(userId: string, url: string): Promise<FollowFeedOutcome> {
      const result = await readFeed(url);
      const feed = result.feed;
      if (!feed) {
        throw new Error('The feed did not return any content');
      }
      const added = await methods.addLibraryFeed(
        userId,
        { feedUrl: feed.feedUrl, title: feed.title, siteUrl: feed.siteUrl ?? undefined },
        MAX_FOLLOWED_FEEDS,
      );
      if (added.status === 'limit') {
        return { status: 'limit' };
      }
      if (added.status === 'exists') {
        return { status: 'exists', feed: added.feed };
      }
      // The feed was just read, so its items are used rather than read a second time.
      const refresh = await saveNewItems(userId, added.feed.id, result, [], MAX_ITEMS_ON_FOLLOW);
      return { status: 'followed', feed: added.feed, refresh };
    },

    listFeeds(userId: string) {
      return methods.listLibraryFeeds(userId);
    },

    async refreshFeed(userId: string, id: string): Promise<FeedRefreshResult | null> {
      const state = await methods.getLibraryFeed(userId, id);
      if (!state) {
        return null;
      }
      const result = await pollFeed(state.feedUrl, {
        etag: state.etag,
        lastModified: state.lastModified,
      });
      return saveNewItems(userId, id, result, state.seenKeys, MAX_ITEMS_PER_REFRESH);
    },

    unfollowFeed(userId: string, id: string) {
      return methods.deleteLibraryFeed(userId, id);
    },

    listUnits(userId: string, documentId: string) {
      return methods.listLibraryUnits(userId, documentId);
    },

    getSource(userId: string, documentId: string) {
      return methods.getLibrarySource(userId, documentId);
    },

    removeSource(userId: string, documentId: string) {
      return methods.deleteLibrarySource(userId, documentId);
    },

    getResource(userId: string, documentId: string, path: string) {
      return methods.getLibraryResource(userId, documentId, path);
    },

    getUnit(userId: string, documentId: string, index: number) {
      return methods.getLibraryUnit(userId, documentId, index);
    },

    list(userId: string, query: LibraryListQuery) {
      return methods.listLibraryDocuments(userId, query);
    },

    search(userId: string, query: string, limit: number) {
      return methods.searchLibraryDocuments(userId, query, limit);
    },

    get(userId: string, id: string) {
      return methods.getLibraryDocument(userId, id);
    },

    update(userId: string, id: string, patch: LibraryDocumentPatch) {
      return methods.updateLibraryDocument(userId, id, patch);
    },

    async saveUnitText(userId: string, documentId: string, index: number, text: string) {
      const clean = cleanOcrText(text);
      if (clean.length < MIN_PAGE_TEXT_CHARS) {
        return { status: 'empty' } as const;
      }
      return methods.saveLibraryUnitText(
        userId,
        documentId,
        index,
        {
          text: clean,
          contentHash: createHash('sha256').update(clean).digest('hex'),
          wordCount: totalWords(clean),
        },
        MIN_PAGE_TEXT_CHARS,
      );
    },

    async exportHighlights(userId: string, format: ExportFormat, documentId?: string) {
      const highlights = await methods.listLibraryHighlights(
        userId,
        documentId,
        EXPORT_MAX_HIGHLIGHTS,
      );
      const documents = await methods.listLibraryDocumentsByIds(userId, [
        ...(documentId ? [documentId] : []),
        ...highlights.map((highlight) => highlight.documentId),
      ]);
      if (documentId && documents.length === 0) {
        return null;
      }
      const rows = highlights.map((highlight) => ({
        documentId: highlight.documentId,
        text: highlight.anchor.exact,
        note: highlight.note,
        color: highlight.color,
        tags: highlight.tags,
        orphaned: highlight.orphaned,
        unit: highlight.unit,
        createdAt: highlight.createdAt,
      }));
      const extension = format === 'csv' ? 'csv' : 'md';
      const stem = documentId ? `highlights-${filenameStem(documents[0].title)}` : 'highlights';
      return {
        filename: `mindferry-${stem}.${extension}`,
        contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8',
        body:
          format === 'csv'
            ? highlightsToCsv(documents, rows)
            : highlightsToMarkdown(documents, rows),
        count: rows.length,
      };
    },

    async dailyReview(userId: string, options: { offsetMinutes?: number; extra?: number } = {}) {
      const since = startOfDay(now(), options.offsetMinutes);
      const extra = Math.min(Math.max(Math.trunc(options.extra ?? 0), 0), MAX_REVIEW_EXTRA);
      const goal = reviewPerDay + extra;
      const reviewedToday = await methods.countLibraryReviewedSince(userId, since);
      const highlights = await methods.listLibraryReviewHighlights(
        userId,
        since,
        Math.max(goal - reviewedToday, 0),
      );
      const documents = await methods.listLibraryDocumentsByIds(
        userId,
        highlights.map((highlight) => highlight.documentId),
      );
      const byId = new Map(documents.map((document) => [document.id, document]));
      const items = highlights.flatMap((highlight) => {
        const document = byId.get(highlight.documentId);
        return document
          ? [
              {
                highlight,
                document: {
                  id: document.id,
                  title: document.title,
                  siteName: document.siteName,
                  kind: document.kind,
                },
              },
            ]
          : [];
      });
      return { items, reviewedToday, goal };
    },

    getInbox(userId: string) {
      return methods.getLibraryInbox(userId);
    },

    async rotateInbox(userId: string) {
      const token = generateInboxToken();
      const { createdAt } = await methods.rotateLibraryInbox(userId, hashInboxToken(token));
      return { token, createdAt };
    },

    deleteInbox(userId: string) {
      return methods.deleteLibraryInbox(userId);
    },

    findInboxOwner(token: string) {
      return methods.findLibraryInboxOwner(hashInboxToken(token));
    },

    async receiveEmail(userId: string, email: InboundEmail) {
      const key = emailKey(email);
      const subject = email.subject || 'Newsletter';
      // Relative links in a message have no page to resolve against; this address is never fetched.
      const base = `https://mail.invalid/${key}`;
      let draft: DocumentDraft;
      try {
        draft = await fromHtml(base, email.html ?? textToHtml(subject, email.text ?? ''));
      } catch (error) {
        if (!(error instanceof NotReadableError) || !email.text) {
          throw error;
        }
        draft = await fromHtml(base, textToHtml(subject, email.text));
      }
      const normalizedUrl = `mail://${key}`;
      const site = email.fromName ?? email.fromAddress?.split('@')[1] ?? null;
      return persist(
        userId,
        {
          ...draft,
          sourceUrl: normalizedUrl,
          normalizedUrl,
          urlKey: urlKey(normalizedUrl),
          title: subject,
          siteName: site,
          byline: email.fromAddress ?? draft.byline,
        },
        'feed',
        ['newsletter'],
        // A newsletter's lead image is often a tracking pixel; fetching it would tell the sender.
        false,
      );
    },

    async chatSource(userId: string, id: string, options: { unitIndex?: number } = {}) {
      const document = await methods.getLibraryDocument(userId, id);
      if (!document) {
        return null;
      }
      const summary = toSummary(document);
      const highlights = await methods.listLibraryHighlights(userId, id, 200);
      if (document.kind === 'article') {
        const { text, truncated } = capText(document.text, chatMaxChars);
        return { document: summary, text, truncated, highlights };
      }
      if (options.unitIndex !== undefined) {
        const unit = await methods.getLibraryUnit(userId, id, options.unitIndex);
        if (!unit) {
          return null;
        }
        const { text, truncated } = capText(unit.text, chatMaxChars);
        return {
          document: summary,
          unit: { kind: unit.kind, index: unit.index },
          text,
          truncated,
          highlights: highlights.filter((highlight) => highlight.unit?.index === unit.index),
        };
      }
      const parts: string[] = [];
      let length = 0;
      let truncated = false;
      for (let index = 0; index < document.unitCount; index += 1) {
        if (length >= chatMaxChars) {
          truncated = true;
          break;
        }
        const unit = await methods.getLibraryUnit(userId, id, index);
        if (!unit || unit.text.trim() === '') {
          continue;
        }
        const piece = `[${unit.kind} ${index + 1}]\n${unit.text}`;
        parts.push(piece);
        length += piece.length + 2;
      }
      const joined = capText(parts.join('\n\n'), chatMaxChars);
      return {
        document: summary,
        text: joined.text,
        truncated: truncated || joined.truncated,
        highlights,
      };
    },

    reviewHighlight(userId: string, id: string, action: ReviewAction) {
      return methods.markLibraryHighlightReviewed(userId, id, { mute: action === 'mute' });
    },

    createFolder(userId: string, name: string) {
      return methods.createLibraryFolder(userId, name, MAX_FOLDERS);
    },

    listFolders(userId: string) {
      return methods.listLibraryFolders(userId);
    },

    renameFolder(userId: string, id: string, name: string) {
      return methods.renameLibraryFolder(userId, id, name);
    },

    deleteFolder(userId: string, id: string) {
      return methods.deleteLibraryFolder(userId, id);
    },

    remove(userId: string, id: string) {
      return methods.deleteLibraryDocument(userId, id);
    },

    async createHighlight(
      userId: string,
      input: LibraryHighlightInput,
    ): Promise<CreateHighlightOutcome> {
      const document = await methods.getLibraryDocument(userId, input.documentId);
      if (!document) return { status: 'not_found' };
      // An article is one text; a book anchors per chapter or page, so the unit decides which text
      // and which hash the selection is checked against. A mismatch in kind is a malformed request.
      const isBook = document.kind !== 'article';
      if (isBook !== (input.unit !== undefined)) return { status: 'mismatch' };
      let text = document.text;
      let currentHash = document.contentHash;
      if (input.unit) {
        const wanted = document.kind === 'pdf' ? 'page' : 'chapter';
        if (input.unit.kind !== wanted) return { status: 'mismatch' };
        const unit = await methods.getLibraryUnit(userId, input.documentId, input.unit.index);
        if (!unit) return { status: 'mismatch' };
        text = unit.text;
        currentHash = unit.contentHash;
      }
      if (input.contentHash !== currentHash) return { status: 'stale' };
      const { start, end, exact } = input.anchor;
      if (end > text.length || text.slice(start, end) !== exact) {
        return { status: 'mismatch' };
      }
      const highlight = await methods.createLibraryHighlight(userId, input);
      return highlight ? { status: 'created', highlight } : { status: 'not_found' };
    },

    listHighlights(userId: string, documentId?: string, limit?: number) {
      return methods.listLibraryHighlights(userId, documentId, limit);
    },

    updateHighlight(userId: string, id: string, patch: LibraryHighlightPatch) {
      return methods.updateLibraryHighlight(userId, id, patch);
    },

    removeHighlight(userId: string, id: string) {
      return methods.deleteLibraryHighlight(userId, id);
    },

    getProgress(userId: string, documentId: string): Promise<LibraryProgressRecord | null> {
      return methods.getLibraryProgress(userId, documentId);
    },

    async setProgress(userId: string, documentId: string, textOffset: number, unitIndex?: number) {
      const document = await methods.getLibraryDocument(userId, documentId);
      if (!document) return null;
      const isBook = document.kind !== 'article';
      if (isBook !== (unitIndex !== undefined)) return null;
      let text = document.text;
      let hash = document.contentHash;
      if (unitIndex !== undefined) {
        const unit = await methods.getLibraryUnit(userId, documentId, unitIndex);
        if (!unit) return null;
        text = unit.text;
        hash = unit.contentHash;
      }
      const offset = Math.min(Math.max(0, Math.trunc(textOffset)), text.length);
      return methods.setLibraryProgress(userId, documentId, offset, hash, unitIndex);
    },
  };
}
