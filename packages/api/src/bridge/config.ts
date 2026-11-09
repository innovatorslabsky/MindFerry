import type { TBridgeDashboard } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';

/** Longest `output` or `constraints` text a person can add to a task. */
export const BRIDGE_MAX_FIELD_CHARS = 500;

export interface BridgeSettings {
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

const DEFAULTS: BridgeSettings = {
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
  return {
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
