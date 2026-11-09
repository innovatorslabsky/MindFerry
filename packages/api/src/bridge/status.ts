import path from 'path';
import { z } from 'zod';
import { constants, promises as fs } from 'fs';
import type {
  TBridgeAgent,
  TBridgeAgentHealth,
  TBridgeAgentStatus,
  TBridgeJobState,
  TBridgeStatus,
} from 'librechat-data-provider';
import { BRIDGE_AGENTS, toOneLine } from './protocol';

/**
 * The host writes `<tasksDir>/.status/agents.json` once a minute with read-only facts about the
 * agents (container state, version, the poll job). The server only reads it. A missing or old file
 * is reported as unknown, never as up.
 */

const MAX_STATUS_BYTES = 65_536;
const FUTURE_SKEW_MS = 120_000;

const iso = z
  .string()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)));

const jobSchema = z.object({
  enabled: z.boolean().optional(),
  lastRunAt: iso.optional(),
  lastOk: z.boolean().optional(),
  consecutiveErrors: z.number().int().min(0).max(100_000).optional(),
  errorKind: z.enum(['billing', 'auth', 'timeout', 'other']).optional(),
});

const agentSchema = z.object({
  container: z.object({ state: z.string().max(20), startedAt: iso.optional() }).optional(),
  version: z.string().max(80).optional(),
  job: jobSchema.optional(),
});

const statusFileSchema = z.object({
  schema: z.literal(1),
  generatedAt: iso,
  agents: z.object({ hermes: agentSchema.optional(), openclaw: agentSchema.optional() }),
});

type AgentFile = z.infer<typeof agentSchema>;

const unknownAgent = (agent: TBridgeAgent): TBridgeAgentStatus => ({
  agent,
  health: 'unknown',
  job: { state: 'unknown' },
});

function jobState(job: AgentFile['job']): TBridgeJobState {
  if (!job) {
    return 'unknown';
  }
  if (job.enabled === false) {
    return 'disabled';
  }
  if (job.lastOk === false || (job.consecutiveErrors ?? 0) > 0) {
    return 'error';
  }
  return job.lastOk === true ? 'ok' : 'unknown';
}

function healthOf(container: AgentFile['container'], fresh: boolean): TBridgeAgentHealth {
  if (!fresh || !container) {
    return 'unknown';
  }
  return container.state === 'running' ? 'up' : 'down';
}

function describe(
  agent: TBridgeAgent,
  file: AgentFile | undefined,
  fresh: boolean,
): TBridgeAgentStatus {
  if (!file) {
    return unknownAgent(agent);
  }
  const version = file.version ? toOneLine(file.version).slice(0, 80) : '';
  return {
    agent,
    health: healthOf(file.container, fresh),
    ...(version ? { version } : {}),
    ...(file.container?.startedAt ? { startedAt: file.container.startedAt } : {}),
    job: {
      state: fresh ? jobState(file.job) : 'unknown',
      ...(file.job?.lastRunAt ? { lastRunAt: file.job.lastRunAt } : {}),
      ...(file.job?.consecutiveErrors ? { consecutiveErrors: file.job.consecutiveErrors } : {}),
      ...(file.job?.errorKind ? { errorKind: file.job.errorKind } : {}),
    },
  };
}

async function readStatusFile(file: string): Promise<unknown> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_STATUS_BYTES) {
      return undefined;
    }
    const buffer = Buffer.alloc(stat.size);
    await handle.read(buffer, 0, stat.size, 0);
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

export async function readAgentStatus(
  tasksDir: string,
  staleSeconds: number,
  now: Date,
): Promise<TBridgeStatus> {
  const raw = await readStatusFile(path.join(tasksDir, '.status', 'agents.json'));
  const parsed = statusFileSchema.safeParse(raw);
  if (!parsed.success) {
    return { stale: true, agents: BRIDGE_AGENTS.map(unknownAgent) };
  }

  const age = now.getTime() - Date.parse(parsed.data.generatedAt);
  const fresh = age <= staleSeconds * 1000 && age >= -FUTURE_SKEW_MS;
  return {
    generatedAt: parsed.data.generatedAt,
    stale: !fresh,
    agents: BRIDGE_AGENTS.map((agent) => describe(agent, parsed.data.agents[agent], fresh)),
  };
}
