import mongoose, { Schema, Document, Types } from 'mongoose';

export const LIBRARY_LOCATIONS = ['inbox', 'later', 'archive', 'feed'] as const;
export type LibraryLocation = (typeof LIBRARY_LOCATIONS)[number];

export interface ILibraryDocument extends Document {
  userId: Types.ObjectId;
  /** sha256 of the normalized URL; unique per user, so saving the same page twice upserts. */
  urlKey: string;
  normalizedUrl: string;
  title: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  publishedTime?: string;
  /** Sanitized HTML. Highlight offsets are `textContent` offsets of exactly this string. */
  contentHtml: string;
  /** Plain text for `$text` search. */
  text: string;
  /** sha256 of `text`; a change means highlights must be re-anchored. */
  contentHash: string;
  wordCount: number;
  readingMinutes: number;
  location: LibraryLocation;
  tags: string[];
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
    title: { type: String, required: true },
    byline: { type: String },
    siteName: { type: String },
    lang: { type: String },
    publishedTime: { type: String },
    contentHtml: { type: String, required: true },
    text: { type: String, required: true },
    contentHash: { type: String, required: true },
    wordCount: { type: Number, required: true, default: 0 },
    readingMinutes: { type: Number, required: true, default: 0 },
    location: { type: String, enum: LIBRARY_LOCATIONS, required: true, default: 'inbox' },
    tags: { type: [String], default: [] },
    fetchedAt: { type: Date, required: true },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

libraryDocumentSchema.index({ userId: 1, urlKey: 1 }, { unique: true });
libraryDocumentSchema.index({ userId: 1, location: 1, updatedAt: -1 });
/** `userId` prefixes the text index so a search is scoped to one user before any scoring. */
libraryDocumentSchema.index({ userId: 1, title: 'text', text: 'text' });

export default libraryDocumentSchema;
