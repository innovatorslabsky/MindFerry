import mongoose, { Schema, Document, Types } from 'mongoose';
import type { BridgeRunStatusValue } from '~/types/bridge';

/** How long a run's record is kept. The daily caps only look at today. */
export const BRIDGE_RUN_RETENTION_SECONDS: number = 90 * 24 * 60 * 60;

export interface IBridgeRun extends Document {
  userId: Types.ObjectId;
  roleId: Types.ObjectId;
  roleSlug: string;
  agentId: string;
  deliveryId: string;
  conversationId: string;
  summary: string;
  status: BridgeRunStatusValue;
  counted: boolean;
  provider?: string;
  /** Stored as `modelName`: `model` would shadow a method every Mongoose document has. */
  modelName?: string;
  day: string;
  error?: string;
  finishedAt?: Date;
  tenantId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const bridgeRunSchema: Schema<IBridgeRun> = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'BridgeRole', required: true },
    roleSlug: { type: String, required: true, maxlength: 60 },
    agentId: { type: String, required: true, maxlength: 200 },
    deliveryId: { type: String, required: true, maxlength: 200 },
    conversationId: { type: String, required: true, maxlength: 200 },
    summary: { type: String, default: '', maxlength: 300 },
    status: {
      type: String,
      enum: ['queued', 'running', 'done', 'failed', 'paused', 'unknown'],
      default: 'queued',
    },
    counted: { type: Boolean, default: false },
    provider: { type: String, maxlength: 100 },
    modelName: { type: String, maxlength: 200 },
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    error: { type: String, maxlength: 100 },
    finishedAt: { type: Date },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

bridgeRunSchema.index({ userId: 1, deliveryId: 1 }, { unique: true });
bridgeRunSchema.index({ userId: 1, roleId: 1, createdAt: -1 });
bridgeRunSchema.index({ userId: 1, day: 1, counted: 1, roleId: 1 });
bridgeRunSchema.index({ createdAt: 1 }, { expireAfterSeconds: BRIDGE_RUN_RETENTION_SECONDS });

export default bridgeRunSchema;
