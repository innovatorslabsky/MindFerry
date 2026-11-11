import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import bridgeRunSchema, { IBridgeRun } from '~/schema/bridgeRun';

export function createBridgeRunModel(mongoose: typeof import('mongoose')): Model<IBridgeRun> {
  applyTenantIsolation(bridgeRunSchema);
  return mongoose.models.BridgeRun || mongoose.model<IBridgeRun>('BridgeRun', bridgeRunSchema);
}
