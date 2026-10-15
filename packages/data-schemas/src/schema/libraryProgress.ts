import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ILibraryProgress extends Document {
  userId: Types.ObjectId;
  documentId: Types.ObjectId;
  /** A text offset, not a scroll pixel, so it survives resizes, font changes and device switches. */
  textOffset: number;
  contentHash: string;
  updatedAt: Date;
  tenantId?: string;
}

const libraryProgressSchema: Schema<ILibraryProgress> = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LibraryDocument',
      required: true,
    },
    textOffset: { type: Number, required: true, min: 0 },
    contentHash: { type: String, required: true },
    tenantId: { type: String, index: true },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

libraryProgressSchema.index({ userId: 1, documentId: 1 }, { unique: true });

export default libraryProgressSchema;
