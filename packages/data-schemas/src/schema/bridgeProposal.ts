import mongoose, { Schema, Document, Types } from 'mongoose';
import type {
  BridgeProposalSourceValue,
  BridgeProposalStatusValue,
  BridgeRuntimeValue,
} from '~/types/bridge';

/** How long a proposal's record is kept. The audit ledger keeps its own, longer, record. */
export const BRIDGE_PROPOSAL_RETENTION_SECONDS: number = 180 * 24 * 60 * 60;

export interface IBridgeProposal extends Document {
  userId: Types.ObjectId;
  source: BridgeProposalSourceValue;
  roleId: Types.ObjectId;
  roleSlug: string;
  runtime: BridgeRuntimeValue;
  title: string;
  content: string;
  hash: string;
  status: BridgeProposalStatusValue;
  dedupeKey?: string;
  originTaskId?: string;
  runId?: Types.ObjectId;
  expiresAt: Date;
  decidedAt?: Date;
  decidedBy?: string;
  tenantId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const bridgeProposalSchema: Schema<IBridgeProposal> = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    source: { type: String, enum: ['person', 'result'], required: true },
    roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'BridgeRole', required: true },
    roleSlug: { type: String, required: true, maxlength: 60 },
    runtime: { type: String, enum: ['app', 'hermes', 'openclaw'], required: true },
    title: { type: String, required: true, maxlength: 200 },
    content: { type: String, required: true, maxlength: 20000, immutable: true },
    hash: { type: String, required: true, match: /^[0-9a-f]{64}$/, immutable: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'denied', 'expired'],
      default: 'pending',
    },
    dedupeKey: { type: String, maxlength: 200 },
    originTaskId: { type: String, maxlength: 200 },
    runId: { type: mongoose.Schema.Types.ObjectId, ref: 'BridgeRun' },
    expiresAt: { type: Date, required: true },
    decidedAt: { type: Date },
    decidedBy: { type: String, maxlength: 100 },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

bridgeProposalSchema.index({ userId: 1, status: 1, createdAt: -1 });
bridgeProposalSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);
bridgeProposalSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: BRIDGE_PROPOSAL_RETENTION_SECONDS },
);

export default bridgeProposalSchema;
