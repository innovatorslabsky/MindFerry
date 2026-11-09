import { z } from 'zod';
import { logger } from '@librechat/data-schemas';
import type {
  TBridgeAgent,
  TBridgeCreateResponse,
  TBridgeError,
  TBridgeErrorCode,
  TBridgeOverview,
  TBridgePriority,
} from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '../types/http';
import { BRIDGE_AGENTS, BRIDGE_PRIORITIES, buildTaskFile, isTaskId, toOneLine } from './protocol';
import { BridgeConflictError, BridgeUnavailableError, createBridgeStore } from './store';
import { BRIDGE_MAX_FIELD_CHARS, getBridgeSettings } from './config';
import { getSafeErrorMetadata } from '../utils/errors';
import { looksLikeSecret } from './secrets';
import { readAgentStatus } from './status';

/**
 * HTTP surface of the agent bridge, for MindFerry's own admin page. The routes that mount these run
 * behind sign-in and the admin check; every handler also answers 404 when the operator has not
 * turned the bridge on. Nothing here runs a command or reads outside the task folder.
 */

export interface BridgeAuditEntry {
  userId: string;
  to: TBridgeAgent;
  id: string;
  priority: TBridgePriority;
  chars: number;
  /** The start of the task text, for a person scanning the log. */
  summary: string;
}

export interface BridgeAudit {
  record(entry: BridgeAuditEntry): Promise<void> | void;
}

/** The audit trail when no store is supplied: a structured log line per task created. */
export const logBridgeAudit: BridgeAudit = {
  record: (entry) => {
    logger.info('[bridge] task created', entry);
  },
};

export interface BridgeDeps {
  audit?: BridgeAudit;
  now?: () => Date;
}

const HOUR_MS = 60 * 60_000;
const AUDIT_SUMMARY_CHARS = 120;

const createSchema = z
  .object({
    to: z.enum(BRIDGE_AGENTS as [TBridgeAgent, ...TBridgeAgent[]]),
    task: z.string(),
    output: z.string().optional(),
    constraints: z.string().optional(),
    priority: z.enum(BRIDGE_PRIORITIES as [TBridgePriority, ...TBridgePriority[]]).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

function fail(res: Response, status: number, error: TBridgeErrorCode, field?: string): void {
  const body: TBridgeError = field ? { error, field } : { error };
  res.status(status).json(body);
}

type BridgeHandler = (req: ServerRequest, res: Response) => Promise<void>;

export interface BridgeHandlers {
  overview: BridgeHandler;
  getResult: BridgeHandler;
  createTask: BridgeHandler;
}

export function createBridgeHandlers(deps: BridgeDeps = {}): BridgeHandlers {
  const audit = deps.audit ?? logBridgeAudit;
  const clock = deps.now ?? (() => new Date());
  const recent = new Map<string, number[]>();

  /** Counts this person's creations in the last hour; false once they are over the limit. */
  function withinLimit(userId: string, perHour: number, now: number): boolean {
    const kept = (recent.get(userId) ?? []).filter((at) => now - at < HOUR_MS);
    if (kept.length >= perHour) {
      recent.set(userId, kept);
      return false;
    }
    recent.set(userId, [...kept, now]);
    return true;
  }

  function settingsOf(req: ServerRequest, res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const settings = getBridgeSettings(req.config);
    if (!settings.enabled) {
      fail(res, 404, 'BRIDGE_DISABLED');
      return null;
    }
    return settings;
  }

  function failure(res: Response, error: unknown): void {
    if (error instanceof BridgeUnavailableError) {
      fail(res, 503, 'BRIDGE_UNAVAILABLE');
      return;
    }
    if (error instanceof BridgeConflictError) {
      fail(res, 409, 'BRIDGE_CONFLICT');
      return;
    }
    logger.error('[bridge] request failed', getSafeErrorMetadata(error));
    res.status(500).json({ error: 'BRIDGE_UNAVAILABLE' satisfies TBridgeErrorCode });
  }

  async function overview(req: ServerRequest, res: Response): Promise<void> {
    const settings = settingsOf(req, res);
    if (!settings) {
      return;
    }
    try {
      const store = createBridgeStore(settings);
      const [listing, status] = await Promise.all([
        store.list(settings.listLimit),
        readAgentStatus(settings.tasksDir, settings.statusStaleSeconds, clock()),
      ]);
      const body: TBridgeOverview = {
        status,
        tasks: listing.tasks,
        truncated: listing.truncated,
        dashboards: settings.dashboards,
        ...(settings.tunnelCommand ? { tunnelCommand: settings.tunnelCommand } : {}),
        limits: { maxTaskChars: settings.maxTaskChars, maxFieldChars: BRIDGE_MAX_FIELD_CHARS },
      };
      res.json(body);
    } catch (error) {
      failure(res, error);
    }
  }

  async function getResult(req: ServerRequest, res: Response): Promise<void> {
    const settings = settingsOf(req, res);
    if (!settings) {
      return;
    }
    const id = (req.params as Record<string, unknown> | undefined)?.id;
    if (!isTaskId(id)) {
      fail(res, 400, 'BRIDGE_INVALID', 'id');
      return;
    }
    try {
      const result = await createBridgeStore(settings).readResult(id);
      if (!result) {
        fail(res, 404, 'BRIDGE_NOT_FOUND');
        return;
      }
      res.json(result);
    } catch (error) {
      failure(res, error);
    }
  }

  async function createTask(req: ServerRequest, res: Response): Promise<void> {
    const settings = settingsOf(req, res);
    if (!settings) {
      return;
    }
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'BRIDGE_INVALID', String(parsed.error.issues[0]?.path[0] ?? ''));
      return;
    }
    const { to, dryRun } = parsed.data;
    const task = toOneLine(parsed.data.task);
    const output = toOneLine(parsed.data.output ?? '');
    const constraints = toOneLine(parsed.data.constraints ?? '');
    const priority = parsed.data.priority ?? 'normal';

    if (task.length < 3 || task.length > settings.maxTaskChars) {
      fail(res, 400, 'BRIDGE_INVALID', 'task');
      return;
    }
    if (output.length > BRIDGE_MAX_FIELD_CHARS) {
      fail(res, 400, 'BRIDGE_INVALID', 'output');
      return;
    }
    if (constraints.length > BRIDGE_MAX_FIELD_CHARS) {
      fail(res, 400, 'BRIDGE_INVALID', 'constraints');
      return;
    }
    if (looksLikeSecret(`${task}\n${output}\n${constraints}`)) {
      fail(res, 400, 'BRIDGE_SECRET_DETECTED');
      return;
    }

    const input = { to, task, output, constraints, priority };
    const now = clock();

    try {
      if (dryRun === true) {
        const built = buildTaskFile(input, { now, tasksDir: settings.tasksDir });
        const body: TBridgeCreateResponse = {
          id: built.id,
          filename: built.filename,
          content: built.content,
          created: false,
        };
        res.json(body);
        return;
      }

      if (!withinLimit(userId, settings.createPerHour, now.getTime())) {
        res.setHeader('Retry-After', '3600');
        fail(res, 429, 'BRIDGE_RATE_LIMITED');
        return;
      }

      const built = await createBridgeStore(settings).create(input, now);
      await audit.record({
        userId,
        to,
        id: built.id,
        priority,
        chars: task.length,
        summary: task.slice(0, AUDIT_SUMMARY_CHARS),
      });
      const body: TBridgeCreateResponse = {
        id: built.id,
        filename: built.filename,
        content: built.content,
        created: true,
      };
      res.status(201).json(body);
    } catch (error) {
      failure(res, error);
    }
  }

  return { overview, getResult, createTask };
}
