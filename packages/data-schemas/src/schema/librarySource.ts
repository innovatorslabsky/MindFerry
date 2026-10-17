import mongoose, { Schema, Document, Types } from 'mongoose';

/** Largest piece of an original file stored in one row; a MongoDB document is capped at 16 MB. */
export const LIBRARY_SOURCE_CHUNK_BYTES: number = 8 * 1024 * 1024;

/**
 * One piece of a PDF's original file, kept only when the operator has turned that on
 * (`contextHub.library.keepPdfOriginals`). A file is stored as chunks `0..n-1`, read back in order.
 */
export interface ILibrarySource extends Document {
  userId: Types.ObjectId;
  documentId: Types.ObjectId;
  index: number;
  bytes: Buffer;
  tenantId?: string;
}

const librarySourceSchema: Schema<ILibrarySource> = new Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'LibraryDocument', required: true },
  index: { type: Number, required: true, min: 0 },
  bytes: { type: Buffer, required: true },
  tenantId: { type: String, index: true },
});

librarySourceSchema.index({ userId: 1, documentId: 1, index: 1 }, { unique: true });

export default librarySourceSchema;
