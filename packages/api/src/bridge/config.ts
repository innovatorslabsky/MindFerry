import type { TBridgeDashboard } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';

/** Longest `output` or `constraints` text a person can add to a task. */
export const BRIDGE_MAX_FIELD_CHARS = 500;

export interface BridgeRoleSettings {
  enabled: boolean;
  dailyCapPerRole: number;
  dailyCapTeam: number;
  assignPerHour: number;
  maxBriefChars: number;
  maxRoles: number;
  fileRolesEnabled: boolean;
}

export interface BridgeApprovalSettings {
  enabled: boolean;
  expiryHours: number;
  maxPending: number;
}

export interface BridgeSettings {
  roles: BridgeRoleSettings;
  approvals: BridgeApprovalSettings;
  enabled: boolean;
  tasksDir: string;
  maxTaskChars: number;
  maxResultBytes: number;
  listLimit: number;
  createPerHour: number;
  statusStaleSeconds: number;
  dashboards: TBridgeDashboard[];
  tunnelCommand?: string;
  scanResults: boolean;
}

const ROLE_DEFAULTS: BridgeRoleSettings = {
  enabled: false,
  dailyCapPerRole: 6,
  dailyCapTeam: 25,
  assignPerHour: 20,
  maxBriefChars: 4000,
  maxRoles: 12,
  fileRolesEnabled: false,
};

const APPROVAL_DEFAULTS: BridgeApprovalSettings = {
  enabled: false,
  expiryHours: 72,
  maxPending: 20,
};

const DEFAULTS: BridgeSettings = {
  roles: ROLE_DEFAULTS,
  approvals: APPROVAL_DEFAULTS,
  enabled: false,
  tasksDir: '/home/deploy/tasks',
  maxTaskChars: 2000,
  maxResultBytes: 131_072,
  listLimit: 100,
  createPerHour: 10,
  statusStaleSeconds: 180,
  dashboards: [],
  scanResults: true,
};

/** The agent bridge settings in force: the operator's, with anything unset filled in. */
export function getBridgeSettings(config: AppConfig | undefined): BridgeSettings {
  const set = config?.agentBridge;
  const roles = set?.roles;
  return {
    roles: {
      enabled: roles?.enabled === true,
      dailyCapPerRole: roles?.dailyCapPerRole ?? ROLE_DEFAULTS.dailyCapPerRole,
      dailyCapTeam: roles?.dailyCapTeam ?? ROLE_DEFAULTS.dailyCapTeam,
      assignPerHour: roles?.assignPerHour ?? ROLE_DEFAULTS.assignPerHour,
      maxBriefChars: roles?.maxBriefChars ?? ROLE_DEFAULTS.maxBriefChars,
      maxRoles: roles?.maxRoles ?? ROLE_DEFAULTS.maxRoles,
      fileRolesEnabled: roles?.fileRolesEnabled === true,
    },
    approvals: {
      enabled: set?.approvals?.enabled === true,
      expiryHours: set?.approvals?.expiryHours ?? APPROVAL_DEFAULTS.expiryHours,
      maxPending: set?.approvals?.maxPending ?? APPROVAL_DEFAULTS.maxPending,
    },
    enabled: set?.enabled === true,
    tasksDir: set?.tasksDir ?? DEFAULTS.tasksDir,
    maxTaskChars: set?.maxTaskChars ?? DEFAULTS.maxTaskChars,
    maxResultBytes: set?.maxResultBytes ?? DEFAULTS.maxResultBytes,
    listLimit: set?.listLimit ?? DEFAULTS.listLimit,
    createPerHour: set?.createPerHour ?? DEFAULTS.createPerHour,
    statusStaleSeconds: set?.statusStaleSeconds ?? DEFAULTS.statusStaleSeconds,
    dashboards: set?.dashboards ?? DEFAULTS.dashboards,
    scanResults: set?.scanResults !== false,
    ...(set?.tunnelCommand ? { tunnelCommand: set.tunnelCommand } : {}),
  };
}

export function isBridgeEnabled(config: AppConfig | undefined): boolean {
  return config?.agentBridge?.enabled === true;
}

/** Roles need both the bridge and the roles switch. */
export function areRolesEnabled(config: AppConfig | undefined): boolean {
  return config?.agentBridge?.enabled === true && config.agentBridge.roles?.enabled === true;
}

/** The approval queue hands work over as role assignments, so it needs the bridge, roles and its own switch. */
export function areApprovalsEnabled(config: AppConfig | undefined): boolean {
  return areRolesEnabled(config) && config?.agentBridge?.approvals?.enabled === true;
}
