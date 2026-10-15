/**
 * Storage-engine-neutral shapes for the reading library. Like the hub types, these carry no
 * Mongoose type in any exported signature, and `data-schemas` does not import them from
 * `@librechat/api`; the service layer maps its own document shape onto these.
 */

export type LibraryLocationValue = 'inbox' | 'later' | 'archive' | 'feed';
export type LibraryHighlightColorValue = 'yellow' | 'blue' | 'green' | 'red' | 'purple';

export interface LibraryAnchorRecord {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
}

export interface LibraryDocumentInput {
  urlKey: string;
  normalizedUrl: string;
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
  fetchedAt: Date;
  /** Only applied when the document is new; saving a page again never moves it out of the archive. */
  location?: LibraryLocationValue;
}

/** A document without its body, which is what listings and search return. */
export interface LibraryDocumentSummary {
  id: string;
  urlKey: string;
  normalizedUrl: string;
  title: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  publishedTime?: string;
  contentHash: string;
  wordCount: number;
  readingMinutes: number;
  location: LibraryLocationValue;
  tags: string[];
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface LibraryDocumentRecord extends LibraryDocumentSummary {
  contentHtml: string;
  text: string;
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
}

export interface LibraryListQuery {
  location?: LibraryLocationValue;
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
  textOffset: number;
  contentHash: string;
  updatedAt: Date;
}

export interface LibraryDataDeleteResult {
  documents: number;
  highlights: number;
  progress: number;
}
