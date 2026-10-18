/** The reading library: saved articles, PDFs and EPUBs, their highlights, and reading position. */

export type TLibraryLocation = 'inbox' | 'later' | 'archive' | 'feed';
export type TLibraryKind = 'article' | 'pdf' | 'epub';
export type TLibraryHighlightColor = 'yellow' | 'blue' | 'green' | 'red' | 'purple';

export type TLibraryTocEntry = {
  title: string;
  depth: number;
  /** Chapter (EPUB) or page (PDF) the entry points at; absent when it points nowhere. */
  unitIndex?: number;
  fragment?: string;
};

/** A document without its text, which is what listings and search return. */
export type TLibraryDocumentSummary = {
  id: string;
  urlKey: string;
  normalizedUrl: string;
  kind: TLibraryKind;
  title: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  publishedTime?: string;
  contentHash: string;
  wordCount: number;
  readingMinutes: number;
  /** Chapters (EPUB) or pages (PDF); 0 for an article. */
  unitCount: number;
  toc: TLibraryTocEntry[];
  /** A PDF with almost no text: probably scanned images. */
  needsOcr?: boolean;
  /** A PDF with more pages than were read. */
  truncated?: boolean;
  /** The original PDF is stored, so a page can be shown as the page itself. */
  hasSource: boolean;
  location: TLibraryLocation;
  tags: string[];
  /** The folder it is filed in, if any. */
  folderId?: string;
  fetchedAt: string;
  createdAt: string;
  updatedAt: string;
};

/** An article with its text. Highlight offsets are `textContent` offsets of `contentHtml`. */
export type TLibraryDocument = TLibraryDocumentSummary & {
  contentHtml: string;
  text: string;
};

export type TLibraryUnitSummary = {
  index: number;
  kind: 'chapter' | 'page';
  title?: string;
  wordCount: number;
  contentHash: string;
};

/** One chapter or page. An EPUB chapter anchors on `text`/`contentHtml`; a PDF page anchors on its reflowed `text`. */
export type TLibraryUnit = TLibraryUnitSummary & {
  documentId: string;
  contentHtml: string;
  text: string;
};

export type TLibraryAnchor = {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
};

export type TLibraryHighlight = {
  id: string;
  documentId: string;
  anchor: TLibraryAnchor;
  color: TLibraryHighlightColor;
  note?: string;
  tags: string[];
  unit?: { kind: 'chapter' | 'page'; index: number };
  contentHash: string;
  /** The text changed and this passage could not be found again; it is kept, not shown in place. */
  orphaned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TLibraryProgress = {
  documentId: string;
  unitIndex?: number;
  textOffset: number;
  contentHash: string;
  updatedAt: string;
};

export type TLibraryListParams = {
  q?: string;
  location?: TLibraryLocation;
  /** Only documents carrying this tag. */
  tag?: string;
  /** A folder id, or `none` for documents in no folder. */
  folder?: string;
  limit?: number;
  skip?: number;
};

export type TLibraryListResponse = { documents: TLibraryDocumentSummary[] };

/** A saved article or a book's listing: a book carries `units` and no text. */
export type TLibraryDocumentResponse =
  | {
      document: TLibraryDocument;
      units?: undefined;
      highlights: TLibraryHighlight[];
      progress: TLibraryProgress | null;
    }
  | {
      document: TLibraryDocumentSummary;
      units: TLibraryUnitSummary[];
      highlights: TLibraryHighlight[];
      progress: TLibraryProgress | null;
    };

export type TLibrarySaveRequest = { url: string; html?: string; location?: TLibraryLocation };

export type TLibrarySaveResponse = {
  document: TLibraryDocumentSummary;
  created: boolean;
  reanchored?: { kept: number; orphaned: number };
};

export type TLibraryReviewItem = {
  highlight: TLibraryHighlight;
  document: Pick<TLibraryDocumentSummary, 'id' | 'title' | 'siteName' | 'kind'>;
};

/** One day's review of old highlights. */
export type TLibraryDailyReview = {
  items: TLibraryReviewItem[];
  /** Highlights gone through since the day began. */
  reviewedToday: number;
  /** How many make up the day's review, counting any "review more". */
  goal: number;
};

/** What to run the chat on, and which chapter or page to ask about (leave out for an article or the book). */
export type TLibraryChatRequest = { endpoint?: string; model?: string; unitIndex?: number };

export type TLibraryChatResponse = { conversationId: string };

export type TLibraryReviewAction = 'done' | 'mute';

export type TLibraryUnitResponse = { unit: TLibraryUnit; highlights: TLibraryHighlight[] };

export type TLibraryCreateHighlight = {
  documentId: string;
  anchor: TLibraryAnchor;
  contentHash: string;
  color?: TLibraryHighlightColor;
  note?: string;
  tags?: string[];
  unit?: { kind: 'chapter' | 'page'; index: number };
};

export type TLibraryPatchHighlight = {
  color?: TLibraryHighlightColor;
  note?: string | null;
  tags?: string[];
};

export type TLibraryFeedItem = {
  guid: string;
  url: string | null;
  title: string;
  author: string | null;
  publishedAt: string | null;
  summary: string | null;
};

export type TLibraryFeedPreview = {
  title: string;
  siteUrl: string | null;
  feedUrl: string;
  description: string | null;
  items: TLibraryFeedItem[];
};

export type TLibraryFeed = {
  id: string;
  feedUrl: string;
  title: string;
  siteUrl?: string;
  lastRefreshedAt?: string;
  createdAt: string;
};

export type TLibraryFeedRefresh = {
  /** New items saved to the Feed tab. */
  added: number;
  /** Items that could not be read; they are not tried again. */
  failed: number;
  /** Items left for a later refresh. */
  skipped: number;
  notModified: boolean;
};

export type TLibraryFollowResponse =
  | { status: 'followed'; feed: TLibraryFeed; refresh: TLibraryFeedRefresh }
  | { status: 'exists'; feed: TLibraryFeed };

export type TLibraryFolder = {
  id: string;
  name: string;
  documentCount: number;
  createdAt: string;
};
