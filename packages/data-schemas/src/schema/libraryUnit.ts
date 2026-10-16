import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * One chapter of an EPUB or one page of a PDF. Each unit has its own text and its own hash because
 * each is its own highlight coordinate space; keeping them out of `LibraryDocument` also keeps a
 * 1,000-page book clear of the 16 MB document limit.
 */
export interface ILibraryUnit extends Document {
  userId: Types.ObjectId;
  documentId: Types.ObjectId;
  index: number;
  kind: 'chapter' | 'page';
  title?: string;
  /** Sanitized chapter HTML; empty for a PDF page. Anchors are `textContent` offsets of this. */
  contentHtml: string;
  /** The anchor space: a chapter's `textContent`, or a PDF page's reflowed text as the reader shows it. */
  text: string;
  wordCount: number;
  contentHash: string;
  tenantId?: string;
}

const libraryUnitSchema: Schema<ILibraryUnit> = new Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'LibraryDocument', required: true },
  index: { type: Number, required: true, min: 0 },
  kind: { type: String, enum: ['chapter', 'page'], required: true },
  title: { type: String },
  contentHtml: { type: String, default: '' },
  text: { type: String, default: '' },
  wordCount: { type: Number, required: true, default: 0 },
  contentHash: { type: String, required: true },
  tenantId: { type: String, index: true },
});

libraryUnitSchema.index({ userId: 1, documentId: 1, index: 1 }, { unique: true });

export default libraryUnitSchema;
