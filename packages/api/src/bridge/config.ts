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

export interface BridgeSettings {
  roles: BridgeRoleSettings;
  enabled: boolean;
  tasksDir: string;
  maxTaskChars: number;
  maxResultBytes: number;
  listLimit: number;
  createPerHour: number;
  statusStaleSeconds: number;
  dashboards: TBridgeDashboard[];
  tunnelCommand?: string;
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

const DEFAULTS: BridgeSettings = {
  roles: ROLE_DEFAULTS,
  enabled: false,
  tasksDir: '/home/deploy/tasks',
  maxTaskChars: 2000,
  maxResultBytes: 131_072,
  listLimit: 100,
  createPerHour: 10,
  statusStaleSeconds: 180,
  dashboards: [],
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
    enabled: set?.enabled === true,
    tasksDir: set?.tasksDir ?? DEFAULTS.tasksDir,
    maxTaskChars: set?.maxTaskChars ?? DEFAULTS.maxTaskChars,
    maxResultBytes: set?.maxResultBytes ?? DEFAULTS.maxResultBytes,
    listLimit: set?.listLimit ?? DEFAULTS.listLimit,
    createPerHour: set?.createPerHour ?? DEFAULTS.createPerHour,
    statusStaleSeconds: set?.statusStaleSeconds ?? DEFAULTS.statusStaleSeconds,
    dashboards: set?.dashboards ?? DEFAULTS.dashboards,
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
