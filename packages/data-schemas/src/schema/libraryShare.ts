import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * A public link to one saved document. Anyone holding the token can read the document, so the token
 * is as long as a secret should be and the link can be withdrawn by deleting this row.
 */
export interface ILibraryShare extends Document {
  userId: Types.ObjectId;
  documentId: Types.ObjectId;
  /** Unguessable; it is the whole of what the public link carries. */
  token: string;
  /** Whether the owner's highlights and notes are part of what is shown. */
  includeHighlights: boolean;
  createdAt: Date;
  updatedAt: Date;
  tenantId?: string;
}

const libraryShareSchema: Schema<ILibraryShare> = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'LibraryDocument', required: true },
    token: { type: String, required: true },
    includeHighlights: { type: Boolean, required: true, default: false },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

// One link per document, and a token that names exactly one of them.
libraryShareSchema.index({ userId: 1, documentId: 1 }, { unique: true });
libraryShareSchema.index({ token: 1 }, { unique: true });

export default libraryShareSchema;
