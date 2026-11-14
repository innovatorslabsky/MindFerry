import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import bridgeAuditSchema, { IBridgeAudit } from '~/schema/bridgeAudit';

export function createBridgeAuditModel(mongoose: typeof import('mongoose')): Model<IBridgeAudit> {
  applyTenantIsolation(bridgeAuditSchema);
  return (
    mongoose.models.BridgeAudit || mongoose.model<IBridgeAudit>('BridgeAudit', bridgeAuditSchema)
  );
}
