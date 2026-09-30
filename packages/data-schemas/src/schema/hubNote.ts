import mongoose, { Schema, Document, Types } from 'mongoose';

export type HubNoteSurface = 'chat' | 'code' | 'agent' | 'other';

export interface IHubNote extends Document {
  userId: Types.ObjectId;
  title: string;
  text: string;
  /** Canonical hub thread id (`${provider}:${sourceId}`) this note is about, if any. */
  threadId?: string;
  /** Which client wrote this note — claude.ai web, Claude Code, an external agent, or unspecified. */
  surface?: HubNoteSurface;
  sessionTag?: string;
  createdAt: Date;
  tenantId?: string;
}

const hubNoteSchema: Schema<IHubNote> = new Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  title: { type: String, required: true },
  text: { type: String, required: true },
  threadId: { type: String, index: true },
  surface: { type: String, enum: ['chat', 'code', 'agent', 'other'] },
  sessionTag: { type: String, maxlength: 200 },
  createdAt: { type: Date, required: true, default: Date.now },
  tenantId: { type: String, index: true },
});

hubNoteSchema.index({ userId: 1, threadId: 1, createdAt: 1 });

/** `userId` prefixes the text index so a note search is scoped to one user's rows, as for threads. */
hubNoteSchema.index({ userId: 1, title: 'text', text: 'text' });

export default hubNoteSchema;
