import mongoose, { Schema, Document, Types } from 'mongoose';

/** A feed the person follows. Items are not stored here; refreshing saves the new ones as documents. */
export interface ILibraryFeed extends Document {
  userId: Types.ObjectId;
  /** The address the feed was read from, after following a site's advertised feed. Unique per user. */
  feedUrl: string;
  title: string;
  siteUrl?: string;
  /** Validators from the last read, so a refresh can be answered "not modified". */
  etag?: string;
  lastModified?: string;
  lastRefreshedAt?: Date;
  /** Keys of items already seen, newest last and capped, so a refresh never saves one twice. */
  seenKeys: string[];
  createdAt: Date;
  updatedAt: Date;
  tenantId?: string;
}

const libraryFeedSchema: Schema<ILibraryFeed> = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    feedUrl: { type: String, required: true },
    title: { type: String, required: true },
    siteUrl: { type: String },
    etag: { type: String },
    lastModified: { type: String },
    lastRefreshedAt: { type: Date },
    seenKeys: { type: [String], default: [] },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

libraryFeedSchema.index({ userId: 1, feedUrl: 1 }, { unique: true });
libraryFeedSchema.index({ userId: 1, updatedAt: -1 });

export default libraryFeedSchema;
