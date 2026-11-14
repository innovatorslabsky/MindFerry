import { Model } from 'mongoose';
import bridgeProposalSchema, { IBridgeProposal } from '~/schema/bridgeProposal';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createBridgeProposalModel(
  mongoose: typeof import('mongoose'),
): Model<IBridgeProposal> {
  applyTenantIsolation(bridgeProposalSchema);
  return (
    mongoose.models.BridgeProposal ||
    mongoose.model<IBridgeProposal>('BridgeProposal', bridgeProposalSchema)
  );
}
