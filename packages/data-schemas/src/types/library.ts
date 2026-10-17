/**
 * Storage-engine-neutral shapes for the reading library. Like the hub types, these carry no
 * Mongoose type in any exported signature, and `data-schemas` does not import them from
 * `@librechat/api`; the service layer maps its own document shape onto these.
 */

export type LibraryLocationValue = 'inbox' | 'later' | 'archive' | 'feed';
export type LibraryKindValue = 'article' | 'pdf' | 'epub';
export type LibraryHighlightColorValue = 'yellow' | 'blue' | 'green' | 'red' | 'purple';

export interface LibraryAnchorRecord {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
}

export interface LibraryTocRecord {
  title: string;
  depth: number;
  unitIndex?: number;
  fragment?: string;
}

export interface LibraryDocumentInput {
  urlKey: string;
  normalizedUrl: string;
  /** Defaults to `article`. */
  kind?: LibraryKindValue;
  title: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  publishedTime?: string;
  contentHtml: string;
  text: string;
  contentHash: string;
  wordCount: number;
  readingMinutes: number;
  unitCount?: number;
  toc?: LibraryTocRecord[];
  needsOcr?: boolean;
  truncated?: boolean;
  fetchedAt: Date;
  /** Only applied when the document is new; saving a page again never moves it out of the archive. */
  location?: LibraryLocationValue;
  /** Only applied when the document is new; a re-save never changes the tags the person has set. */
  tags?: string[];
}

/** A document without its body, which is what listings and search return. */
export interface LibraryDocumentSummary {
  id: string;
  urlKey: string;
  normalizedUrl: string;
  kind: LibraryKindValue;
  title: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  publishedTime?: string;
  contentHash: string;
  wordCount: number;
  readingMinutes: number;
  unitCount: number;
  toc: LibraryTocRecord[];
  needsOcr?: boolean;
  truncated?: boolean;
  /** The original PDF is kept, so its pages can be shown as images. */
  hasSource: boolean;
  location: LibraryLocationValue;
  tags: string[];
  folderId?: string;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface LibraryDocumentRecord extends LibraryDocumentSummary {
  contentHtml: string;
  text: string;
}

export interface LibraryUnitInput {
  index: number;
  kind: 'chapter' | 'page';
  title?: string;
  contentHtml?: string;
  text: string;
  wordCount: number;
  contentHash: string;
}

/** A unit without its text, which is what a table of contents or a page list needs. */
export interface LibraryUnitSummary {
  index: number;
  kind: 'chapter' | 'page';
  title?: string;
  wordCount: number;
  contentHash: string;
}

export interface LibraryUnitRecord extends LibraryUnitSummary {
  documentId: string;
  contentHtml: string;
  text: string;
}

export type LibraryImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface LibraryResourceInput {
  path: string;
  mediaType: LibraryImageMediaType;
  bytes: Uint8Array;
}

export interface LibraryResourceRecord {
  path: string;
  mediaType: LibraryImageMediaType;
  bytes: Buffer;
}

export interface LibraryBookInput extends LibraryDocumentInput {
  units: LibraryUnitInput[];
  /** Images the chapters refer to. Replaced together with the units. */
  resources?: LibraryResourceInput[];
}

export interface LibraryDocumentSaveResult {
  document: LibraryDocumentRecord;
  created: boolean;
  /** The text differs from the stored copy, so existing highlights need re-anchoring. */
  contentChanged: boolean;
}

export interface LibraryDocumentPatch {
  location?: LibraryLocationValue;
  tags?: string[];
  /** A folder id to file the document in, or `null` to take it out of its folder. */
  folderId?: string | null;
}

export interface LibraryListQuery {
  location?: LibraryLocationValue;
  /** Only documents carrying this tag. */
  tag?: string;
  /** Only documents in this folder, or only those in none when `'none'`. */
  folder?: string;
  limit: number;
  skip?: number;
}

export interface LibraryHighlightInput {
  documentId: string;
  anchor: LibraryAnchorRecord;
  color?: LibraryHighlightColorValue;
  note?: string;
  tags?: string[];
  unit?: { kind: 'chapter' | 'page'; index: number };
  contentHash: string;
}

export interface LibraryHighlightRecord {
  id: string;
  documentId: string;
  anchor: LibraryAnchorRecord;
  color: LibraryHighlightColorValue;
  note?: string;
  tags: string[];
  unit?: { kind: 'chapter' | 'page'; index: number };
  contentHash: string;
  orphaned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LibraryHighlightPatch {
  color?: LibraryHighlightColorValue;
  note?: string | null;
  tags?: string[];
}

/** The outcome of re-resolving one highlight against revised text. `anchor: null` orphans it. */
export interface LibraryReanchor {
  id: string;
  anchor: LibraryAnchorRecord | null;
  contentHash: string;
}

export interface LibraryProgressRecord {
  documentId: string;
  unitIndex?: number;
  textOffset: number;
  contentHash: string;
  updatedAt: Date;
}

export interface LibraryDataDeleteResult {
  documents: number;
  highlights: number;
  progress: number;
  units: number;
  resources: number;
  sources: number;
  folders: number;
  feeds: number;
}

export interface LibraryFeedRecord {
  id: string;
  feedUrl: string;
  title: string;
  siteUrl?: string;
  lastRefreshedAt?: Date;
  createdAt: Date;
}

/** What a refresh needs to remember about a feed: its validators and how many items it has seen. */
export interface LibraryFeedState extends LibraryFeedRecord {
  etag?: string;
  lastModified?: string;
  seenKeys: string[];
}

export interface LibraryFeedInput {
  feedUrl: string;
  title: string;
  siteUrl?: string;
}

export type LibraryFeedAddResult =
  { status: 'added' | 'exists'; feed: LibraryFeedRecord } | { status: 'limit' };

export interface LibraryFeedRefreshRecord {
  title?: string;
  etag?: string | null;
  lastModified?: string | null;
  /** Keys to add to those already seen. */
  newKeys: string[];
}

export interface LibraryFolderRecord {
  id: string;
  name: string;
  /** Documents currently filed in it. */
  documentCount: number;
  createdAt: Date;
}

export type LibraryFolderCreateResult =
  { status: 'created' | 'exists'; folder: LibraryFolderRecord } | { status: 'limit' };

export type LibraryFolderRenameResult =
  | { status: 'renamed'; folder: LibraryFolderRecord }
  | { status: 'not_found' }
  | { status: 'exists' };

export interface LibraryUnitTextInput {
  text: string;
  contentHash: string;
  wordCount: number;
}

export type LibraryUnitTextResult =
  | { status: 'saved'; unit: LibraryUnitRecord; needsOcr: boolean }
  | { status: 'not_found' | 'has_text' };
