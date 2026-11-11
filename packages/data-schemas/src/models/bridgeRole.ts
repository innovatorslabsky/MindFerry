import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import bridgeRoleSchema, { IBridgeRole } from '~/schema/bridgeRole';

export function createBridgeRoleModel(mongoose: typeof import('mongoose')): Model<IBridgeRole> {
  applyTenantIsolation(bridgeRoleSchema);
  return mongoose.models.BridgeRole || mongoose.model<IBridgeRole>('BridgeRole', bridgeRoleSchema);
}
