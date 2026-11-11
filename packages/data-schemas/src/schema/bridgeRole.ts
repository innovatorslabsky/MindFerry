import mongoose, { Schema, Document, Types } from 'mongoose';
import type { BridgeRuntimeValue } from '~/types/bridge';

/** Larger than the API allows, so a limit change never strands a stored value. */
export const BRIDGE_ROLE_MAX_BRIEF = 16_000;

export interface IBridgeRole extends Document {
  userId: Types.ObjectId;
  slug: string;
  name: string;
  description: string;
  runtime: BridgeRuntimeValue;
  agentId?: string;
  brief: string;
  tier: 0 | 1;
  dailyCap?: number;
  enabled: boolean;
  templateId?: string;
  tenantId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const bridgeRoleSchema: Schema<IBridgeRole> = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    slug: { type: String, required: true, maxlength: 60 },
    name: { type: String, required: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 600 },
    runtime: { type: String, enum: ['app', 'hermes', 'openclaw'], required: true },
    agentId: { type: String, maxlength: 200 },
    brief: { type: String, default: '', maxlength: BRIDGE_ROLE_MAX_BRIEF },
    tier: { type: Number, enum: [0, 1], default: 0 },
    dailyCap: { type: Number, min: 1, max: 1000 },
    enabled: { type: Boolean, default: true },
    templateId: { type: String, maxlength: 60 },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

bridgeRoleSchema.index({ userId: 1, slug: 1 }, { unique: true });

export default bridgeRoleSchema;
