import mongoose, { Schema, Document, Types } from 'mongoose';

export const LIBRARY_HIGHLIGHT_COLORS = ['yellow', 'blue', 'green', 'red', 'purple'] as const;
export type LibraryHighlightColor = (typeof LIBRARY_HIGHLIGHT_COLORS)[number];

export interface ILibraryAnchor {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
}

export interface ILibraryHighlight extends Document {
  userId: Types.ObjectId;
  documentId: Types.ObjectId;
  anchor: ILibraryAnchor;
  color: LibraryHighlightColor;
  note?: string;
  tags: string[];
  /** Chapter (EPUB) or page (PDF) the anchor lives in; absent for a single-text article. */
  unit?: { kind: 'chapter' | 'page'; index: number };
  /** `contentHash` of the text the anchor was made against. */
  contentHash: string;
  /** Set when a re-extraction could no longer place the anchor; the highlight is kept, not dropped. */
  orphaned: boolean;
  createdAt: Date;
  updatedAt: Date;
  tenantId?: string;
}

const anchorSchema = new Schema<ILibraryAnchor>(
  {
    exact: { type: String, required: true },
    prefix: { type: String, default: '' },
    suffix: { type: String, default: '' },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
  },
  { _id: false },
);

const libraryHighlightSchema: Schema<ILibraryHighlight> = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LibraryDocument',
      required: true,
    },
    anchor: { type: anchorSchema, required: true },
    color: { type: String, enum: LIBRARY_HIGHLIGHT_COLORS, required: true, default: 'yellow' },
    note: { type: String },
    tags: { type: [String], default: [] },
    unit: {
      type: new Schema(
        {
          kind: { type: String, enum: ['chapter', 'page'], required: true },
          index: { type: Number, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
    contentHash: { type: String, required: true },
    orphaned: { type: Boolean, required: true, default: false },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

libraryHighlightSchema.index({ userId: 1, documentId: 1, createdAt: 1 });

export default libraryHighlightSchema;
