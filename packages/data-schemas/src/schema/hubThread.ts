import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * One message segment as archived. Mirrors the shape `@librechat/api`'s
 * `HubSegment` produces, but this file (and this collection) must not import
 * from `packages/api` — the storage engine stays behind the data-schemas
 * boundary, so the shape is duplicated here rather than shared by import.
 */
export interface IHubSegment {
  kind: 'text' | 'thinking' | 'code' | 'tool';
  text: string;
  language?: string;
  name?: string;
}

export interface IHubMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  createdAt: Date;
  segments: IHubSegment[];
  parentId: string | null;
  model?: string;
}

export interface IHubThread extends Document {
  userId: Types.ObjectId;
  /** Canonical `${provider}:${sourceId}`, unique per user. */
  id: string;
  provider: string;
  /** Which client the conversation came from; absent for imported exports. */
  surface?: 'chat' | 'code' | 'agent' | 'other';
  sourceId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: IHubMessage[];
  /** Denormalized title + message text, rebuilt on every upsert, for `$text` search. */
  searchText: string;
  /** When this row was last written, independent of the conversation's own timestamps. */
  syncedAt: Date;
  tenantId?: string;
}

const hubSegmentSchema = new Schema<IHubSegment>(
  {
    kind: { type: String, enum: ['text', 'thinking', 'code', 'tool'], required: true },
    text: { type: String, required: true },
    language: { type: String },
    name: { type: String },
  },
  { _id: false },
);

const hubMessageSchema = new Schema<IHubMessage>(
  {
    id: { type: String, required: true },
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    createdAt: { type: Date, required: true },
    segments: { type: [hubSegmentSchema], required: true, default: [] },
    parentId: { type: String, default: null },
    model: { type: String },
  },
  { _id: false },
);

const hubThreadSchema: Schema<IHubThread> = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    id: { type: String, required: true },
    provider: { type: String, required: true, index: true },
    surface: { type: String, enum: ['chat', 'code', 'agent', 'other'] },
    sourceId: { type: String, required: true },
    title: { type: String, required: true },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
    messages: { type: [hubMessageSchema], required: true, default: [] },
    searchText: { type: String, required: true, default: '' },
    syncedAt: { type: Date, required: true, default: Date.now },
    tenantId: { type: String, index: true },
  },
  { minimize: false },
);

/** Natural key: re-archiving the same export upserts in place rather than duplicating. */
hubThreadSchema.index({ userId: 1, id: 1 }, { unique: true });

/**
 * `userId` prefixes the text index so a search is scoped to one user's rows
 * before MongoDB scores any text match. `provider` filtering is applied as a
 * plain equality predicate alongside `$text` rather than folded into this
 * index — a compound text index only accepts equality-filtered fields as its
 * non-text prefix, and archives are small enough per user that the extra
 * predicate costs nothing measurable.
 */
hubThreadSchema.index({ userId: 1, title: 'text', searchText: 'text' });

export default hubThreadSchema;
