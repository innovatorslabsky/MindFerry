import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import bridgeProposalSchema, { IBridgeProposal } from '~/schema/bridgeProposal';

export function createBridgeProposalModel(
  mongoose: typeof import('mongoose'),
): Model<IBridgeProposal> {
  applyTenantIsolation(bridgeProposalSchema);
  return (
    mongoose.models.BridgeProposal ||
    mongoose.model<IBridgeProposal>('BridgeProposal', bridgeProposalSchema)
  );
}
