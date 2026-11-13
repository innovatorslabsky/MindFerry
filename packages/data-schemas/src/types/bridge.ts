/**
 * Storage-engine-neutral shapes for the agent bridge's roles and the tasks handed to them. Like the
 * hub and library types, these carry no Mongoose type in any exported signature.
 */

export type BridgeRuntimeValue = 'app' | 'hermes' | 'openclaw';
/** `paused` is a run waiting for a person to approve a tool call. */
export type BridgeRunStatusValue = 'queued' | 'running' | 'done' | 'failed' | 'paused' | 'unknown';

export interface BridgeRoleRecord {
  id: string;
  userId: string;
  /** Stable, URL-safe name, unique for the person. */
  slug: string;
  name: string;
  description: string;
  runtime: BridgeRuntimeValue;
  /** The in-app agent a role of runtime `app` runs; absent for the other runtimes. */
  agentId?: string;
  /** For a host-agent role: the role file's name in the tasks folder, without `.md`. */
  roleFile?: string;
  /** Text put before the task each time this role is given one. */
  brief: string;
  /** Risk tier. Only 0 (read and draft) and 1 are allowed; 2 and 3 are not a stored value. */
  tier: 0 | 1;
  /** Runs a day for this role; absent means the deployment default. */
  dailyCap?: number;
  enabled: boolean;
  templateId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BridgeRoleInput {
  slug: string;
  name: string;
  description?: string;
  runtime: BridgeRuntimeValue;
  agentId?: string;
  roleFile?: string;
  brief?: string;
  tier?: 0 | 1;
  dailyCap?: number;
  enabled?: boolean;
  templateId?: string;
}

/** `dailyCap: null` removes the role's own cap, so the deployment default applies again. */
export interface BridgeRolePatch {
  name?: string;
  description?: string;
  agentId?: string;
  brief?: string;
  tier?: 0 | 1;
  dailyCap?: number | null;
  enabled?: boolean;
}

export type BridgeRoleCreateResult =
  | { ok: true; role: BridgeRoleRecord }
  | { ok: false; code: 'slug_taken' | 'limit' };

export interface BridgeRunRecord {
  id: string;
  userId: string;
  roleId: string;
  roleSlug: string;
  agentId: string;
  /** Stable for one hand-over, so a repeated request never starts a second run. */
  deliveryId: string;
  runtime: BridgeRuntimeValue;
  /** The chat of an in-app run. */
  conversationId?: string;
  /** The task file of a host-agent run, set once the file is written. */
  taskId?: string;
  /** The start of the task text, for lists. */
  summary: string;
  status: BridgeRunStatusValue;
  /** Counts against the daily caps: a run that reaches a paid model. */
  counted: boolean;
  provider?: string;
  model?: string;
  /** The UTC day the run counts toward, `YYYY-MM-DD`. */
  day: string;
  /** A short, safe code for why it failed. */
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  finishedAt?: Date;
}

export interface BridgeRunInput {
  roleId: string;
  roleSlug: string;
  agentId: string;
  deliveryId: string;
  runtime?: BridgeRuntimeValue;
  conversationId?: string;
  summary: string;
  counted: boolean;
  provider?: string;
  model?: string;
  day: string;
}

export interface BridgeRunCaps {
  /** Most counted runs the role may have in the day; absent means no cap. */
  role?: number;
  /** Most counted runs all roles together may have in the day; absent means no cap. */
  team?: number;
}

export type BridgeRunReserveResult =
  | { ok: true; run: BridgeRunRecord; created: boolean }
  | { ok: false; code: 'cap_role' | 'cap_team'; used: number; cap: number };

export interface BridgeRunPatch {
  taskId?: string;
  status?: BridgeRunStatusValue;
  error?: string;
  /** Set to false to give a run's slot back, for a run that never reached the model. */
  counted?: boolean;
  finishedAt?: Date;
}

export interface BridgeUsageRecord {
  team: number;
  byRole: Record<string, number>;
}
