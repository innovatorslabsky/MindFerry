import type {
  LibraryDocumentPatch,
  LibraryDocumentRecord,
  LibraryDocumentSummary,
  LibraryFeedRecord,
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
import { createAnchor, resolveAnchor } from './anchor/textQuote';
import type { FeedFetchResult } from './feed/fetchFeed';
import { saveHtml, saveUrl } from './ingest/saveDocument';
import { ingestUpload } from './ingest/upload';
import { fetchFeed, subscribeToUrl } from './feed/fetchFeed';
import { feedItemKey } from './feed/parseFeed';
import type { LibraryIngest } from './worker/ingest';
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
  | 'getLibraryDocument'
  | 'listLibraryDocuments'
  | 'searchLibraryDocuments'
  | 'updateLibraryDocument'
  | 'deleteLibraryDocument'
  | 'createLibraryHighlight'
  | 'listLibraryHighlights'
  | 'updateLibraryHighlight'
  | 'deleteLibraryHighlight'
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

/** Most feeds one person may follow. */
export const MAX_FOLLOWED_FEEDS = 50;
/** Items saved by one refresh. Each is a fetch of a third-party page, so the number is kept small. */
export const MAX_ITEMS_PER_REFRESH = 10;
/** The first refresh, when following, saves only the newest few rather than a feed's whole history. */
export const MAX_ITEMS_ON_FOLLOW = 5;

export function createLibraryService({ methods, ingest = {} }: LibraryServiceDeps): LibraryService {
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
    });
    const reanchored = saved.contentChanged
      ? await reanchor(userId, saved.document)
      : { kept: 0, orphaned: 0 };
    return { document: toSummary(saved.document), created: saved.created, reanchored };
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
      const saved = await methods.saveLibraryBook(userId, { ...book, location });
      return { document: toSummary(saved.document), created: saved.created };
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
