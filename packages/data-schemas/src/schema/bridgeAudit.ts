import mongoose, { Schema, Document, Types } from 'mongoose';
import type { BridgeAuditActionValue } from '~/types/bridge';

/** How long a ledger line is kept before the database drops it. */
export const BRIDGE_AUDIT_RETENTION_SECONDS: number = 365 * 24 * 60 * 60;

export interface IBridgeAudit extends Document {
  userId: Types.ObjectId;
  action: BridgeAuditActionValue;
  proposalId?: Types.ObjectId;
  actor: string;
  roleSlug?: string;
  hash?: string;
  detail?: string;
  tenantId?: string;
  createdAt: Date;
}

const immutable = true;

const bridgeAuditSchema: Schema<IBridgeAudit> = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable },
    action: {
      type: String,
      enum: [
        'proposal_created',
        'proposal_approved',
        'proposal_denied',
        'proposal_expired',
        'handed_over',
        'handover_failed',
      ],
      required: true,
      immutable,
    },
    proposalId: { type: mongoose.Schema.Types.ObjectId, ref: 'BridgeProposal', immutable },
    actor: { type: String, required: true, maxlength: 100, immutable },
    roleSlug: { type: String, maxlength: 60, immutable },
    hash: { type: String, match: /^[0-9a-f]{64}$/, immutable },
    detail: { type: String, maxlength: 200, immutable },
    tenantId: { type: String, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/** The ledger is append-only: nothing in the application changes or removes a line. */
const BLOCKED = [
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
] as const;
for (const operation of BLOCKED) {
  bridgeAuditSchema.pre(operation, function () {
    throw new Error('the bridge audit ledger is append-only');
  });
}
bridgeAuditSchema.pre('save', function () {
  if (!this.isNew) {
    throw new Error('the bridge audit ledger is append-only');
  }
});

bridgeAuditSchema.index({ userId: 1, createdAt: -1 });
bridgeAuditSchema.index({ userId: 1, proposalId: 1, createdAt: 1 });
bridgeAuditSchema.index({ createdAt: 1 }, { expireAfterSeconds: BRIDGE_AUDIT_RETENTION_SECONDS });

export default bridgeAuditSchema;
