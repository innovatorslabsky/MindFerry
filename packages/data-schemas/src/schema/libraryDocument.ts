import mongoose, { Schema, Document, Types } from 'mongoose';

export const LIBRARY_LOCATIONS = ['inbox', 'later', 'archive', 'feed'] as const;
export type LibraryLocation = (typeof LIBRARY_LOCATIONS)[number];

export const LIBRARY_KINDS = ['article', 'pdf', 'epub'] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export interface ILibraryTocEntry {
  title: string;
  depth: number;
  /** Index of the chapter (EPUB) or page (PDF) the entry points at; absent when it points nowhere. */
  unitIndex?: number;
  fragment?: string;
}

export interface ILibraryDocument extends Document {
  userId: Types.ObjectId;
  /** sha256 of the normalized URL; unique per user, so saving the same page twice upserts. */
  urlKey: string;
  normalizedUrl: string;
  /** `article` is one text; `epub` and `pdf` are split into units stored in `LibraryUnit`. */
  kind: LibraryKind;
  title: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  publishedTime?: string;
  /** Sanitized HTML. Highlight offsets are `textContent` offsets of exactly this string. Empty for a book. */
  contentHtml: string;
  /** Plain text for `$text` search. For a book, the start of the text, capped. */
  text: string;
  /** sha256 of `text`; a change means highlights must be re-anchored. */
  contentHash: string;
  /** The opening of `text`, for a line under the title in a listing. */
  excerpt?: string;
  /** The person's own note on the document. */
  note?: string;
  /** A short summary the person keeps with the document. */
  summary?: string;
  /** The person changed the title or author, so saving the page again must not put the page's back. */
  metaEdited?: boolean;
  wordCount: number;
  readingMinutes: number;
  /** Chapters (EPUB) or pages (PDF); 0 for an article. */
  unitCount: number;
  toc: ILibraryTocEntry[];
  /** A PDF with almost no text: probably scanned images, and not searchable until OCR exists. */
  needsOcr?: boolean;
  /** A PDF with more pages than were read. */
  truncated?: boolean;
  /** Path of the `LibraryResource` that is this document's small picture: a book's cover or an article's lead image. */
  thumbnailPath?: string;
  /** The original PDF file is stored (`LibrarySource`), so a page can be shown as the page itself. */
  hasSource?: boolean;
  location: LibraryLocation;
  tags: string[];
  /** The folder the document is filed in, if any. */
  folderId?: Types.ObjectId;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  tenantId?: string;
}

const libraryDocumentSchema: Schema<ILibraryDocument> = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    urlKey: { type: String, required: true },
    normalizedUrl: { type: String, required: true },
    kind: { type: String, enum: LIBRARY_KINDS, required: true, default: 'article' },
    title: { type: String, required: true },
    byline: { type: String },
    siteName: { type: String },
    lang: { type: String },
    publishedTime: { type: String },
    contentHtml: { type: String, default: '' },
    text: { type: String, default: '' },
    contentHash: { type: String, required: true },
    excerpt: { type: String },
    thumbnailPath: { type: String },
    note: { type: String },
    summary: { type: String },
    metaEdited: { type: Boolean },
    wordCount: { type: Number, required: true, default: 0 },
    readingMinutes: { type: Number, required: true, default: 0 },
    unitCount: { type: Number, required: true, default: 0 },
    toc: {
      type: [
        new Schema<ILibraryTocEntry>(
          {
            title: { type: String, required: true },
            depth: { type: Number, required: true },
            unitIndex: { type: Number },
            fragment: { type: String },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    needsOcr: { type: Boolean },
    truncated: { type: Boolean },
    hasSource: { type: Boolean },
    location: { type: String, enum: LIBRARY_LOCATIONS, required: true, default: 'inbox' },
    tags: { type: [String], default: [] },
    folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'LibraryFolder' },
    fetchedAt: { type: Date, required: true },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

libraryDocumentSchema.index({ userId: 1, urlKey: 1 }, { unique: true });
libraryDocumentSchema.index({ userId: 1, location: 1, updatedAt: -1 });
libraryDocumentSchema.index({ userId: 1, tags: 1, updatedAt: -1 });
libraryDocumentSchema.index({ userId: 1, folderId: 1, updatedAt: -1 });
/** `userId` prefixes the text index so a search is scoped to one user before any scoring. */
libraryDocumentSchema.index({ userId: 1, title: 'text', text: 'text' });

export default libraryDocumentSchema;
