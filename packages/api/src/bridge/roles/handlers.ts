import { z } from 'zod';
import { logger } from '@librechat/data-schemas';
import type { TBridgeRolesErrorCode, TBridgeErrorCode } from 'librechat-data-provider';
import type { Response } from 'express';
import type { RolesActor, RolesDeps, RolesFailure } from './service';
import type { BridgeSettings } from '../config';
import type { BridgeStore } from '../store';
import type { ServerRequest } from '../../types/http';
import { areRolesEnabled, getBridgeSettings } from '../config';
import { getSafeErrorMetadata } from '../../utils/errors';
import { createBridgeStore } from '../store';
import { createRolesService } from './service';

export type RolesServiceDeps = Omit<RolesDeps, 'getSettings' | 'fileTasks'> & {
  /** Builds the task-folder store for the settings in force. Defaults to the real folder. */
  createStore?: (settings: BridgeSettings) => BridgeStore;
};

const STATUS: Record<TBridgeRolesErrorCode, number> = {
  ROLE_INVALID: 400,
  ROLE_SECRET_DETECTED: 400,
  ROLE_NOT_FOUND: 404,
  ROLE_SLUG_TAKEN: 409,
  ROLE_LIMIT: 409,
  ROLE_DISABLED: 409,
  ROLE_LOCKED: 403,
  ROLE_AGENT_UNAVAILABLE: 422,
  CAP_ROLE: 429,
  CAP_TEAM: 429,
  ASSIGN_RATE_LIMITED: 429,
  ASSIGN_FAILED: 502,
};

const tierSchema = z.union([z.literal(0), z.literal(1)]);
const createSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    runtime: z.enum(['app', 'hermes', 'openclaw']).optional(),
    agentId: z.string().min(1).max(100).optional(),
    roleFile: z.string().max(80).optional(),
    brief: z.string().optional(),
    tier: tierSchema.optional(),
    dailyCap: z.number().nullable().optional(),
    templateId: z.string().max(60).optional(),
  })
  .strict();
const patchSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    agentId: z.string().min(1).max(100).optional(),
    brief: z.string().optional(),
    tier: tierSchema.optional(),
    dailyCap: z.number().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
const assignSchema = z.object({ requestId: z.string(), task: z.string() }).strict();

const paramId = (req: ServerRequest): string =>
  String((req.params as Record<string, unknown> | undefined)?.id ?? '');

type Handler = (req: ServerRequest, res: Response) => Promise<void>;

export interface RolesHandlers {
  overview: Handler;
  create: Handler;
  update: Handler;
  remove: Handler;
  assign: Handler;
}

function reject(res: Response, failure: RolesFailure): void {
  const { code, ...rest } = failure;
  res.status(STATUS[code]).json({ error: code, ...rest });
}

/** HTTP surface for roles. Mounted behind sign-in and the admin check; 404 unless roles are on. */
export function createRolesHandlers(deps: RolesServiceDeps): RolesHandlers {
  function open(req: ServerRequest, res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const actor = req.user;
    if (!areRolesEnabled(req.config)) {
      res.status(404).json({ error: 'BRIDGE_DISABLED' satisfies TBridgeErrorCode });
      return null;
    }
    if (!actor?.id) {
      res.status(401).json({ error: 'BRIDGE_UNAVAILABLE' satisfies TBridgeErrorCode });
      return null;
    }
    const settings = getBridgeSettings(req.config);
    const store = (deps.createStore ?? createBridgeStore)(settings);
    const who: RolesActor = {
      id: String(actor.id),
      ...(actor.role ? { role: actor.role } : {}),
      ...(actor.tenantId ? { tenantId: actor.tenantId } : {}),
    };
    return {
      who,
      service: createRolesService({
        ...deps,
        getSettings: () => settings,
        fileTasks: {
          create: (input, at) => store.create(input, at),
          state: (id) => store.taskState(id),
        },
      }),
    };
  }

  const guard =
    (
      run: (
        ctx: NonNullable<ReturnType<typeof open>>,
        req: ServerRequest,
        res: Response,
      ) => Promise<void>,
    ): Handler =>
    async (req, res) => {
      const ctx = open(req, res);
      if (!ctx) {
        return;
      }
      try {
        await run(ctx, req, res);
      } catch (error) {
        logger.error('[bridge] roles request failed', getSafeErrorMetadata(error));
        res.status(500).json({ error: 'BRIDGE_UNAVAILABLE' satisfies TBridgeErrorCode });
      }
    };

  const invalid = (res: Response, field?: string) =>
    reject(res, { code: 'ROLE_INVALID', ...(field ? { field } : {}) });

  return {
    overview: guard(async ({ who, service }, _req, res) => {
      res.json(await service.overview(who.id));
    }),
    create: guard(async ({ who, service }, req, res) => {
      const body = createSchema.safeParse(req.body);
      if (!body.success) {
        return invalid(res, String(body.error.issues[0]?.path[0] ?? ''));
      }
      const result = await service.createRole(who, body.data);
      if (!result.ok) {
        return reject(res, result.error);
      }
      res.status(201).json(result.value);
    }),
    update: guard(async ({ who, service }, req, res) => {
      const body = patchSchema.safeParse(req.body);
      if (!body.success) {
        return invalid(res, String(body.error.issues[0]?.path[0] ?? ''));
      }
      const result = await service.updateRole(who, paramId(req), body.data);
      if (!result.ok) {
        return reject(res, result.error);
      }
      res.json(result.value);
    }),
    remove: guard(async ({ who, service }, req, res) => {
      const result = await service.deleteRole(who.id, paramId(req));
      if (!result.ok) {
        return reject(res, result.error);
      }
      res.status(204).end();
    }),
    assign: guard(async ({ who, service }, req, res) => {
      const body = assignSchema.safeParse(req.body);
      if (!body.success) {
        return invalid(res, String(body.error.issues[0]?.path[0] ?? ''));
      }
      const result = await service.assign(who, paramId(req), body.data);
      if (!result.ok) {
        return reject(res, result.error);
      }
      res.status(result.value.replayed ? 200 : 202).json(result.value);
    }),
  };
}
