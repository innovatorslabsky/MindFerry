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

export type BridgeProposalStatusValue = 'pending' | 'approved' | 'denied' | 'expired';
/** Where a proposal came from: a person typed it, or it was read out of an agent's result. */
export type BridgeProposalSourceValue = 'person' | 'result';

export interface BridgeProposalRecord {
  id: string;
  userId: string;
  source: BridgeProposalSourceValue;
  roleId: string;
  roleSlug: string;
  runtime: BridgeRuntimeValue;
  /** A short line for lists. */
  title: string;
  /** The exact task text that runs if this is approved. It never changes after creation. */
  content: string;
  /** SHA-256 of what was shown to the person; an approval must name it. */
  hash: string;
  status: BridgeProposalStatusValue;
  /** Stable for one proposed item, so reading the same result twice adds it once. */
  dedupeKey?: string;
  /** The task whose result suggested this, for a proposal read from a result. */
  originTaskId?: string;
  /** The run that was started when this was approved. */
  runId?: string;
  expiresAt: Date;
  decidedAt?: Date;
  decidedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BridgeProposalInput {
  source: BridgeProposalSourceValue;
  roleId: string;
  roleSlug: string;
  runtime: BridgeRuntimeValue;
  title: string;
  content: string;
  hash: string;
  dedupeKey?: string;
  originTaskId?: string;
  expiresAt: Date;
}

export type BridgeProposalCreateResult =
  | { ok: true; proposal: BridgeProposalRecord; created: boolean }
  | { ok: false; code: 'limit'; pending: number; cap: number };

export type BridgeProposalDecision = 'approve' | 'deny';

/** `changed: false` means the proposal already had this decision, so a repeat does nothing. */
export type BridgeProposalDecideResult =
  | { ok: true; proposal: BridgeProposalRecord; changed: boolean }
  | { ok: false; code: 'not_found' | 'not_pending' | 'expired' | 'hash_mismatch' };

export type BridgeAuditActionValue =
  | 'proposal_created'
  | 'proposal_approved'
  | 'proposal_denied'
  | 'proposal_expired'
  | 'handed_over'
  | 'handover_failed';

export interface BridgeAuditRecord {
  id: string;
  userId: string;
  action: BridgeAuditActionValue;
  proposalId?: string;
  /** Who did it: `user:<id>` or `system`. */
  actor: string;
  roleSlug?: string;
  /** The proposal's content hash, so the ledger shows what was approved. */
  hash?: string;
  /** A short, safe code or note. Never free text from an agent. */
  detail?: string;
  createdAt: Date;
}

export interface BridgeAuditInput {
  action: BridgeAuditActionValue;
  proposalId?: string;
  actor: string;
  roleSlug?: string;
  hash?: string;
  detail?: string;
}
