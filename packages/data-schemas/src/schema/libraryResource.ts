import mongoose, { Schema, Document, Types } from 'mongoose';

export const LIBRARY_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type LibraryImageType = (typeof LIBRARY_IMAGE_TYPES)[number];

/** An image from inside a book, kept so its chapters can show it. Only raster images are stored. */
export interface ILibraryResource extends Document {
  userId: Types.ObjectId;
  documentId: Types.ObjectId;
  /** Path inside the book, as chapters refer to it in `data-epub-resource`. */
  path: string;
  /** Detected from the bytes by the parser, never taken from the book's own claim. */
  mediaType: LibraryImageType;
  bytes: Buffer;
  size: number;
  tenantId?: string;
}

const libraryResourceSchema: Schema<ILibraryResource> = new Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'LibraryDocument', required: true },
  path: { type: String, required: true },
  mediaType: { type: String, enum: LIBRARY_IMAGE_TYPES, required: true },
  bytes: { type: Buffer, required: true },
  size: { type: Number, required: true, min: 0 },
  tenantId: { type: String, index: true },
});

libraryResourceSchema.index({ userId: 1, documentId: 1, path: 1 }, { unique: true });

export default libraryResourceSchema;
