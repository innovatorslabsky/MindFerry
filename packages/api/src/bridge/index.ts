/**
 * Public surface of the agent bridge. The protocol and store internals stay private: names like
 * `slugify` or `isTaskId` are too generic to export from the package root.
 */
export { getBridgeSettings, isBridgeEnabled } from './config';
export { createBridgeHandlers, logBridgeAudit } from './routes';
export type { BridgeAudit, BridgeAuditEntry, BridgeDeps, BridgeHandlers } from './routes';
export { createRolesHandlers, createRolesService, BRIDGE_ROLE_TEMPLATES } from './roles';
export type { RolesHandlers, RolesServiceDeps, RolesActor, RolesService } from './roles';
