import { z } from 'zod';
import { logger } from '@librechat/data-schemas';
import type { TBridgeApprovalsErrorCode, TBridgeErrorCode } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ApprovalMethods, ApprovalsFailure } from './service';
import type { RolesServiceDeps } from '../roles/handlers';
import type { ServerRequest } from '../../types/http';
import type { RolesActor } from '../roles/service';
import { areApprovalsEnabled, getBridgeSettings } from '../config';
import { getSafeErrorMetadata } from '../../utils/errors';
import { buildRolesService } from '../roles/handlers';
import { createApprovalsService } from './service';
import { createBridgeStore } from '../store';
import { isTaskId } from '../protocol';

export type ApprovalsServiceDeps = Omit<RolesServiceDeps, 'methods'> & {
  methods: RolesServiceDeps['methods'] & ApprovalMethods;
};

const STATUS: Record<TBridgeApprovalsErrorCode, number> = {
  APPROVAL_INVALID: 400,
  APPROVAL_SECRET_DETECTED: 400,
  APPROVAL_NOT_FOUND: 404,
  APPROVAL_NOT_PENDING: 409,
  APPROVAL_EXPIRED: 409,
  APPROVAL_HASH_MISMATCH: 409,
  APPROVAL_LIMIT: 429,
  APPROVAL_ROLE_UNAVAILABLE: 409,
  APPROVAL_HANDOVER_FAILED: 502,
};

const createSchema = z
  .object({ requestId: z.string(), roleId: z.string(), task: z.string() })
  .strict();
const decideSchema = z
  .object({ decision: z.enum(['approve', 'deny']), hash: z.string().optional() })
  .strict();

const paramId = (req: ServerRequest): string =>
  String((req.params as Record<string, unknown> | undefined)?.id ?? '');

type Handler = (req: ServerRequest, res: Response) => Promise<void>;

export interface ApprovalsHandlers {
  overview: Handler;
  create: Handler;
  decide: Handler;
  importResult: Handler;
  audit: Handler;
}

function reject(res: Response, failure: ApprovalsFailure): void {
  const { code, ...rest } = failure;
  res.status(STATUS[code]).json({ error: code, ...rest });
}

/**
 * HTTP surface for the approval queue. Mounted behind sign-in and the admin check; 404 unless the
 * bridge, roles and approvals are all on. An approval hands the work to the roles service, so the
 * handlers take the same dependencies.
 */
export function createApprovalsHandlers(deps: ApprovalsServiceDeps): ApprovalsHandlers {
  const guard =
    (
      run: (
        ctx: { who: RolesActor; service: ReturnType<typeof createApprovalsService> },
        req: ServerRequest,
        res: Response,
      ) => Promise<void>,
    ): Handler =>
    async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const actor = req.user;
      if (!areApprovalsEnabled(req.config)) {
        res.status(404).json({ error: 'BRIDGE_DISABLED' satisfies TBridgeErrorCode });
        return;
      }
      if (!actor?.id) {
        res.status(401).json({ error: 'BRIDGE_UNAVAILABLE' satisfies TBridgeErrorCode });
        return;
      }
      const settings = getBridgeSettings(req.config);
      const who: RolesActor = {
        id: String(actor.id),
        ...(actor.role ? { role: actor.role } : {}),
        ...(actor.tenantId ? { tenantId: actor.tenantId } : {}),
      };
      const roles = buildRolesService(deps, settings);
      const service = createApprovalsService({
        methods: deps.methods,
        getSettings: () => settings,
        handOver: (by, roleId, request) => roles.assign(by, roleId, request),
        readResult: (taskId) =>
          (deps.createStore ?? createBridgeStore)(settings).readResult(taskId),
      });
      try {
        await run({ who, service }, req, res);
      } catch (error) {
        logger.error('[bridge] approvals request failed', getSafeErrorMetadata(error));
        res.status(500).json({ error: 'BRIDGE_UNAVAILABLE' satisfies TBridgeErrorCode });
      }
    };

  const invalid = (res: Response, field?: string) =>
    reject(res, { code: 'APPROVAL_INVALID', ...(field ? { field } : {}) });

  return {
    overview: guard(async ({ who, service }, _req, res) => {
      res.json(await service.overview(who.id));
    }),
    create: guard(async ({ who, service }, req, res) => {
      const body = createSchema.safeParse(req.body);
      if (!body.success) {
        return invalid(res, String(body.error.issues[0]?.path[0] ?? ''));
      }
      const result = await service.create(who, body.data);
      if (!result.ok) {
        return reject(res, result.error);
      }
      res.status(201).json(result.value);
    }),
    decide: guard(async ({ who, service }, req, res) => {
      const body = decideSchema.safeParse(req.body);
      if (!body.success) {
        return invalid(res, String(body.error.issues[0]?.path[0] ?? ''));
      }
      const result = await service.decide(who, paramId(req), body.data);
      if (!result.ok) {
        return reject(res, result.error);
      }
      res.json(result.value);
    }),
    importResult: guard(async ({ who, service }, req, res) => {
      const taskId = paramId(req);
      if (!isTaskId(taskId)) {
        return invalid(res, 'id');
      }
      const result = await service.importFromResult(who, taskId);
      if (!result.ok) {
        return reject(res, result.error);
      }
      res.status(result.value.added > 0 ? 201 : 200).json(result.value);
    }),
    audit: guard(async ({ who, service }, req, res) => {
      const raw = (req.query as Record<string, unknown> | undefined)?.proposalId;
      const proposalId = typeof raw === 'string' && raw.length > 0 ? raw : undefined;
      res.json({ lines: await service.audit(who.id, proposalId) });
    }),
  };
}
