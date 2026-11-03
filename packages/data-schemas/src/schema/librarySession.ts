import mongoose, { Schema, Document, Types } from 'mongoose';

export const LIBRARY_SESSION_KINDS = ['auto', 'manual'] as const;
export type LibrarySessionKind = (typeof LIBRARY_SESSION_KINDS)[number];

/**
 * One stretch of reading a document. An `auto` session is kept up to date by the reader while it is
 * open; a `manual` one is logged by hand for reading done elsewhere. The numbers are the person's own
 * and are only ever shown to them.
 */
export interface ILibrarySession extends Document {
  userId: Types.ObjectId;
  documentId: Types.ObjectId;
  /** Names the session for the one who is writing it, so the same one can be updated rather than doubled. */
  sid: string;
  kind: LibrarySessionKind;
  startedAt: Date;
  endedAt: Date;
  /** Seconds the reader was actually reading, not the time between start and end. */
  activeSeconds: number;
  words: number;
  createdAt: Date;
  updatedAt: Date;
  tenantId?: string;
}

const librarySessionSchema: Schema<ILibrarySession> = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'LibraryDocument', required: true },
    sid: { type: String, required: true },
    kind: { type: String, enum: LIBRARY_SESSION_KINDS, required: true, default: 'auto' },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
    activeSeconds: { type: Number, required: true, default: 0, min: 0 },
    words: { type: Number, required: true, default: 0, min: 0 },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

librarySessionSchema.index({ userId: 1, sid: 1 }, { unique: true });
librarySessionSchema.index({ userId: 1, startedAt: -1 });
librarySessionSchema.index({ userId: 1, documentId: 1, startedAt: -1 });

export default librarySessionSchema;
