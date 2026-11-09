/** The agent bridge: the shared task folder between MindFerry and the agents on the VPS. */

export type TBridgeAgent = 'hermes' | 'openclaw';
export type TBridgePriority = 'low' | 'normal' | 'high';
/** `queued` waits in inbox, `running` was picked up, `done`/`failed` have a result, `archived` was filed. */
export type TBridgeTaskState = 'queued' | 'running' | 'done' | 'failed' | 'archived';
export type TBridgeResultStatus = 'DONE' | 'FAILED' | 'UNKNOWN';
/** `unknown` is what an agent shows when the status snapshot is missing or too old to trust. */
export type TBridgeAgentHealth = 'up' | 'down' | 'unknown';
export type TBridgeJobState = 'ok' | 'error' | 'disabled' | 'unknown';
/** A stable code for why the poll job failed, so the UI can say it in the user's language. */
export type TBridgeErrorKind = 'billing' | 'auth' | 'timeout' | 'other';

export type TBridgeAgentStatus = {
  agent: TBridgeAgent;
  health: TBridgeAgentHealth;
  version?: string;
  startedAt?: string;
  job: {
    state: TBridgeJobState;
    lastRunAt?: string;
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

export type TBridgeResult = {
  id: string;
  status: TBridgeResultStatus;
  /** Written by an agent: untrusted text, to be rendered as sanitized Markdown only. */
  text: string;
  truncated: boolean;
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
