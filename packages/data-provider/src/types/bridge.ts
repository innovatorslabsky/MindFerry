/** The agent bridge: the shared task folder between MindFerry and the agents on the VPS. */

export type TBridgeAgent = 'hermes' | 'openclaw';
export type TBridgePriority = 'low' | 'normal' | 'high';
/** `queued` waits in inbox, `running` was picked up, `done`/`failed` have a result, `archived` was filed. */
export type TBridgeTaskState = 'queued' | 'running' | 'done' | 'failed' | 'archived';
export type TBridgeResultStatus = 'DONE' | 'FAILED' | 'UNKNOWN';
/** `unknown` is what an agent shows when the status snapshot is missing or too old to trust. */
export type TBridgeAgentHealth = 'up' | 'down' | 'unknown';
export type TBridgeJobState = 'ok' | 'error' | 'disabled' | 'unknown';
/** A stable code for why the poll job failed, so the UI can say it in the user's language.
 *  `stalled` means a poll that should have run by now has not. */
export type TBridgeErrorKind = 'billing' | 'auth' | 'timeout' | 'stalled' | 'other';
/** What runs the poll: a job inside the agent's runtime, or the host's own cron calling the agent
 *  only when there is a task (an empty poll never calls the model, which is normal). */
export type TBridgePollKind = 'runtime-job' | 'host-cron';

export type TBridgeAgentStatus = {
  agent: TBridgeAgent;
  health: TBridgeAgentHealth;
  version?: string;
  startedAt?: string;
  job: {
    state: TBridgeJobState;
    kind?: TBridgePollKind;
    /** The latest poll (for a host cron, the latest tick, even when it found nothing to do). */
    lastRunAt?: string;
    /** The latest time a real task was handed to the agent. */
    lastCallAt?: string;
    /** How the latest finished hand-over went. `false` means that task was left unfinished. */
    lastCallOk?: boolean;
    intervalMinutes?: number;
    consecutiveErrors?: number;
    errorKind?: TBridgeErrorKind;
  };
};

export type TBridgeStatus = {
  /** When the host wrote the snapshot; absent when there is none. */
  generatedAt?: string;
  /** True when there is no snapshot or it is older than `statusStaleSeconds`. */
  stale: boolean;
  agents: TBridgeAgentStatus[];
};

export type TBridgeTask = {
  id: string;
  to: TBridgeAgent;
  state: TBridgeTaskState;
  created?: string;
  priority?: TBridgePriority;
  /** First characters of the task line, for the list. Plain text. */
  summary: string;
  hasResult: boolean;
  resultStatus?: TBridgeResultStatus;
  /** Picked up more than an hour ago with no result yet. A hint only: nothing is moved. */
  stuck?: boolean;
};

export type TBridgeDashboard = { name: string; url: string };

export type TBridgeOverview = {
  status: TBridgeStatus;
  tasks: TBridgeTask[];
  /** True when more tasks exist than the list shows. */
  truncated: boolean;
  dashboards: TBridgeDashboard[];
  tunnelCommand?: string;
  limits: { maxTaskChars: number; maxFieldChars: number };
};

/** What a scan of an agent's result found. A hint for the reader, never a verdict. */
export type TBridgeResultWarningCode =
  | 'secret'
  | 'banned_claim'
  | 'placeholder_example'
  | 'claim_phrase'
  | 'link_data'
  | 'link_credentials'
  | 'link_scheme'
  | 'link_host'
  | 'hidden_char';

export type TBridgeResultWarning = {
  code: TBridgeResultWarningCode;
  /** The line it was found on; absent when it spans lines. */
  line?: number;
  /** For a claim word or phrase: which one, taken from a fixed list. Never text from the result. */
  term?: string;
};

export type TBridgeResult = {
  id: string;
  status: TBridgeResultStatus;
  /** Written by an agent: untrusted text, to be rendered as sanitized Markdown only. */
  text: string;
  truncated: boolean;
  /** Present only when the scan found something. */
  warnings?: TBridgeResultWarning[];
  /** How many more findings were left out of `warnings`. */
  warningsOmitted?: number;
};

export type TBridgeCreateRequest = {
  to: TBridgeAgent;
  task: string;
  /** What the person expects back; folded into the task line. */
  output?: string;
  /** Extra constraints; the standing ones are always kept. */
  constraints?: string;
  priority?: TBridgePriority;
  /** Build and return the file without writing it. */
  dryRun?: boolean;
};

export type TBridgeCreateResponse = {
  id: string;
  filename: string;
  /** The exact file content, as written (or as it would be written for a dry run). */
  content: string;
  created: boolean;
};

export type TBridgeErrorCode =
  | 'BRIDGE_DISABLED'
  | 'BRIDGE_INVALID'
  | 'BRIDGE_SECRET_DETECTED'
  | 'BRIDGE_RATE_LIMITED'
  | 'BRIDGE_NOT_FOUND'
  | 'BRIDGE_CONFLICT'
  | 'BRIDGE_UNAVAILABLE';

export type TBridgeError = { error: TBridgeErrorCode; field?: string };

/* ---- Roles (GĐ1): named jobs a person can hand work to. ---- */

export type TBridgeRoleRuntime = 'app' | 'hermes' | 'openclaw';
/** 0 = read and draft only; 1 = may write inside its own scope. Higher tiers stay locked. */
export type TBridgeRoleTier = 0 | 1;
export type TBridgeRunStatus = 'queued' | 'running' | 'done' | 'failed' | 'paused' | 'unknown';

export type TBridgeRole = {
  id: string;
  slug: string;
  name: string;
  description: string;
  runtime: TBridgeRoleRuntime;
  /** The in-app agent this role runs as (runtime `app`). */
  agentId?: string;
  /** The role file on the host (runtime `hermes` or `openclaw`), without `.md`. */
  roleFile?: string;
  /** Standing instructions added to every assignment (an in-app role; a host role keeps them in its file). */
  brief: string;
  tier: TBridgeRoleTier;
  /** Per-role daily cap; absent means the operator's default. */
  dailyCap?: number;
  enabled: boolean;
  templateId?: string;
  createdAt: string;
  updatedAt: string;
};

export type TBridgeRoleTemplate = {
  id: string;
  name: string;
  description: string;
  brief: string;
  tier: TBridgeRoleTier;
};

export type TBridgeRoleInput = {
  name: string;
  description?: string;
  runtime?: TBridgeRoleRuntime;
  agentId?: string;
  roleFile?: string;
  brief?: string;
  tier?: TBridgeRoleTier;
  dailyCap?: number | null;
  templateId?: string;
};

export type TBridgeRolePatch = Partial<TBridgeRoleInput> & { enabled?: boolean };

export type TBridgeRun = {
  id: string;
  roleId: string;
  roleSlug: string;
  runtime: TBridgeRoleRuntime;
  summary: string;
  status: TBridgeRunStatus;
  /** Whether this run counts toward the daily caps (a real model call). */
  counted: boolean;
  /** The chat of an in-app run. */
  conversationId?: string;
  /** The task file of a host-agent run; its result opens in the result dialog. */
  taskId?: string;
  /** A host-agent run picked up more than an hour ago with no result: it may be stuck. */
  stuck?: boolean;
  /** Stable code for why the run failed; never raw provider text. */
  error?: string;
  createdAt: string;
  finishedAt?: string;
};

export type TBridgeRoleUsage = {
  day: string;
  team: { used: number; cap: number };
  byRole: Record<string, { used: number; cap: number }>;
};

export type TBridgeRolesOverview = {
  roles: TBridgeRole[];
  templates: TBridgeRoleTemplate[];
  runs: TBridgeRun[];
  usage: TBridgeRoleUsage;
  limits: { maxBriefChars: number; maxRoles: number };
  /** `file` roles open only when the operator has enabled them. */
  fileRolesEnabled: boolean;
};

export type TBridgeAssignRequest = {
  /** Client-made id; the same id never starts a second run. */
  requestId: string;
  task: string;
};

export type TBridgeAssignResponse = { run: TBridgeRun; replayed: boolean };

export type TBridgeRolesErrorCode =
  | 'ROLE_INVALID'
  | 'ROLE_SECRET_DETECTED'
  | 'ROLE_SLUG_TAKEN'
  | 'ROLE_LIMIT'
  | 'ROLE_NOT_FOUND'
  | 'ROLE_DISABLED'
  | 'ROLE_LOCKED'
  | 'ROLE_AGENT_UNAVAILABLE'
  | 'CAP_ROLE'
  | 'CAP_TEAM'
  | 'ASSIGN_RATE_LIMITED'
  | 'ASSIGN_FAILED';

export type TBridgeRolesError = {
  error: TBridgeRolesErrorCode;
  field?: string;
  used?: number;
  cap?: number;
};
