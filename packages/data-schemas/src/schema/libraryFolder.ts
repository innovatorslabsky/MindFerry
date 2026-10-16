import mongoose, { Schema, Document, Types } from 'mongoose';

/** A folder a person files documents into. One level, and a document is in at most one. */
export interface ILibraryFolder extends Document {
  userId: Types.ObjectId;
  name: string;
  /** Lower-cased name, so "Psychology" and "psychology" are the same folder. */
  nameKey: string;
  createdAt: Date;
  updatedAt: Date;
  tenantId?: string;
}

const libraryFolderSchema: Schema<ILibraryFolder> = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    nameKey: { type: String, required: true },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

libraryFolderSchema.index({ userId: 1, nameKey: 1 }, { unique: true });

export default libraryFolderSchema;
