import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * A person's address for receiving newsletters: a secret in the URL an email service posts to. Only
 * a hash of it is kept, so a database read cannot be turned into the ability to add to a library.
 */
export interface ILibraryInbox extends Document {
  userId: Types.ObjectId;
  /** SHA-256 of the secret in the address. */
  tokenHash: string;
  createdAt: Date;
  updatedAt: Date;
  tenantId?: string;
}

const libraryInboxSchema: Schema<ILibraryInbox> = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

libraryInboxSchema.index({ userId: 1 }, { unique: true });
libraryInboxSchema.index({ tokenHash: 1 }, { unique: true });

export default libraryInboxSchema;
