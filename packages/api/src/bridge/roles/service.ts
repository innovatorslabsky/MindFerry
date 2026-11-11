import { randomUUID } from 'node:crypto';
import type {
  TBridgeRole,
  TBridgeRun,
  TBridgeRolesErrorCode,
  TBridgeRoleInput,
  TBridgeRolePatch,
  TBridgeRolesOverview,
  TBridgeAssignResponse,
} from 'librechat-data-provider';
import type {
  BridgeMethods,
  BridgeRoleRecord,
  BridgeRunRecord,
  BridgeRunStatusValue,
} from '@librechat/data-schemas';
import type { AgentTriggerEnvelope } from '../../agents/triggers/envelope';
import type { BridgeSettings } from '../config';
import {
  AgentTriggerEnvelopeError,
  createAgentTriggerEnvelope,
} from '../../agents/triggers/envelope';
import { AgentTriggerServiceUnavailableError } from '../../agents/triggers/service';
import { AgentTriggerDeliveryError } from '../../agents/triggers/delivery';
import { BRIDGE_ROLE_TEMPLATES, getRoleTemplate } from './templates';
import { looksLikeSecret } from '../secrets';

export type RolesFailure = {
  code: TBridgeRolesErrorCode;
  field?: string;
  used?: number;
  cap?: number;
};
export type RolesResult<T> = { ok: true; value: T } | { ok: false; error: RolesFailure };

type RoleMethods = Pick<
  BridgeMethods,
  | 'createBridgeRole'
  | 'getBridgeRole'
  | 'listBridgeRoles'
  | 'updateBridgeRole'
  | 'deleteBridgeRole'
  | 'reserveBridgeRun'
  | 'updateBridgeRun'
  | 'listBridgeRuns'
  | 'getBridgeUsage'
>;

export type JobStatus = 'running' | 'complete' | 'error' | 'aborted' | 'requires_action';

export interface RolesDeps {
  methods: RoleMethods;
  getSettings: () => BridgeSettings;
  /** Finds an agent the person may run, or null. The caller owns the permission check. */
  resolveAgent: (
    actor: RolesActor,
    agentId: string,
  ) => Promise<{ id: string; provider?: string; model?: string } | null>;
  enqueueTrigger: (
    envelope: AgentTriggerEnvelope,
    options?: { orderingKey?: string },
  ) => Promise<unknown>;
  getJobStatus: (conversationId: string) => Promise<JobStatus | null | undefined>;
  now?: () => Date;
  newId?: () => string;
}

export interface RolesActor {
  id: string;
  role?: string;
  tenantId?: string;
}

/** Counted runs are only those that reach the paid Anthropic API. */
export const COUNTED_PROVIDER = 'anthropic';
const NAME_MAX = 80;
const DESCRIPTION_MAX = 300;
const SUMMARY_CHARS = 140;
const SLUG_TRIES = 6;
/** A run the job manager has no record of for this long is shown as unknown, not queued. */
const UNKNOWN_AFTER_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const RUNS_SHOWN = 30;

const fail = <T>(
  code: TBridgeRolesErrorCode,
  extra: Omit<RolesFailure, 'code'> = {},
): RolesResult<T> => ({
  ok: false,
  error: { code, ...extra },
});
const ok = <T>(value: T): RolesResult<T> => ({ ok: true, value });

const TERMINAL: ReadonlySet<BridgeRunStatusValue> = new Set(['done', 'failed']);

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'role';
}

export function toRole(record: BridgeRoleRecord): TBridgeRole {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    runtime: record.runtime,
    ...(record.agentId ? { agentId: record.agentId } : {}),
    brief: record.brief,
    tier: record.tier,
    ...(record.dailyCap != null ? { dailyCap: record.dailyCap } : {}),
    enabled: record.enabled,
    ...(record.templateId ? { templateId: record.templateId } : {}),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toRun(record: BridgeRunRecord): TBridgeRun {
  return {
    id: record.id,
    roleId: record.roleId,
    roleSlug: record.roleSlug,
    summary: record.summary,
    status: record.status,
    counted: record.counted,
    conversationId: record.conversationId,
    ...(record.error ? { error: record.error } : {}),
    createdAt: record.createdAt.toISOString(),
    ...(record.finishedAt ? { finishedAt: record.finishedAt.toISOString() } : {}),
  };
}

function definiteEnqueueFailure(error: unknown): boolean {
  return (
    error instanceof AgentTriggerEnvelopeError ||
    error instanceof AgentTriggerDeliveryError ||
    error instanceof AgentTriggerServiceUnavailableError
  );
}

function composeInput(role: BridgeRoleRecord, task: string): string {
  const scope =
    role.tier === 0
      ? 'Scope: read and draft only. Do not take any action with side effects outside this conversation.'
      : 'Scope: you may write inside this agent’s own workspace. Do not take any action that reaches other people or accounts.';
  const parts = [`Role: ${role.name}`, scope];
  if (role.brief.trim().length > 0) {
    parts.push(`Standing brief:\n${role.brief.trim()}`);
  }
  parts.push(`Task:\n${task}`);
  return parts.join('\n\n');
}

export function createRolesService(deps: RolesDeps) {
  const { methods } = deps;
  const now = () => (deps.now ? deps.now() : new Date());
  const newId = deps.newId ?? randomUUID;
  const dayOf = (date: Date) => date.toISOString().slice(0, 10);

  function validateText(
    value: string | undefined,
    field: string,
    max: number,
  ): RolesFailure | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value.length > max) {
      return { code: 'ROLE_INVALID', field };
    }
    if (looksLikeSecret(value)) {
      return { code: 'ROLE_SECRET_DETECTED', field };
    }
    return undefined;
  }

  async function checkAgent(actor: RolesActor, agentId: string): Promise<boolean> {
    return (await deps.resolveAgent(actor, agentId)) != null;
  }

  async function createRole(
    actor: RolesActor,
    input: TBridgeRoleInput,
  ): Promise<RolesResult<TBridgeRole>> {
    const settings = deps.getSettings().roles;
    const template = getRoleTemplate(input.templateId);
    if (input.templateId !== undefined && !template) {
      return fail('ROLE_INVALID', { field: 'templateId' });
    }
    const name = input.name?.trim() ?? '';
    if (name.length === 0 || name.length > NAME_MAX) {
      return fail('ROLE_INVALID', { field: 'name' });
    }
    const runtime = input.runtime ?? 'app';
    if (runtime !== 'app') {
      return fail('ROLE_LOCKED');
    }
    if (input.tier !== undefined && input.tier !== 0 && input.tier !== 1) {
      return fail('ROLE_INVALID', { field: 'tier' });
    }
    if (
      input.dailyCap != null &&
      (!Number.isInteger(input.dailyCap) || input.dailyCap < 1 || input.dailyCap > 1000)
    ) {
      return fail('ROLE_INVALID', { field: 'dailyCap' });
    }
    const brief = input.brief ?? template?.brief ?? '';
    const description = input.description ?? template?.description ?? '';
    const invalid =
      validateText(brief, 'brief', settings.maxBriefChars) ??
      validateText(description, 'description', DESCRIPTION_MAX);
    if (invalid) {
      return { ok: false, error: invalid };
    }
    if (!input.agentId || !(await checkAgent(actor, input.agentId))) {
      return fail('ROLE_AGENT_UNAVAILABLE', { field: 'agentId' });
    }

    const base = slugify(name);
    for (let attempt = 0; attempt < SLUG_TRIES; attempt++) {
      const slug = attempt === 0 ? base : `${base.slice(0, 36)}-${attempt + 1}`;
      const created = await methods.createBridgeRole(
        actor.id,
        {
          slug,
          name,
          description,
          runtime,
          agentId: input.agentId,
          brief,
          tier: input.tier ?? template?.tier ?? 0,
          ...(input.dailyCap != null ? { dailyCap: input.dailyCap } : {}),
          ...(template ? { templateId: template.id } : {}),
        },
        settings.maxRoles,
      );
      if (created.ok) {
        return ok(toRole(created.role));
      }
      if (created.code === 'limit') {
        return fail('ROLE_LIMIT', { cap: settings.maxRoles });
      }
    }
    return fail('ROLE_SLUG_TAKEN', { field: 'name' });
  }

  async function updateRole(
    actor: RolesActor,
    id: string,
    patch: TBridgeRolePatch,
  ): Promise<RolesResult<TBridgeRole>> {
    const settings = deps.getSettings().roles;
    const next: Parameters<RoleMethods['updateBridgeRole']>[2] = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name.length === 0 || name.length > NAME_MAX) {
        return fail('ROLE_INVALID', { field: 'name' });
      }
      next.name = name;
    }
    if (patch.tier !== undefined) {
      if (patch.tier !== 0 && patch.tier !== 1) {
        return fail('ROLE_INVALID', { field: 'tier' });
      }
      next.tier = patch.tier;
    }
    if (patch.dailyCap !== undefined) {
      if (
        patch.dailyCap !== null &&
        (!Number.isInteger(patch.dailyCap) || patch.dailyCap < 1 || patch.dailyCap > 1000)
      ) {
        return fail('ROLE_INVALID', { field: 'dailyCap' });
      }
      next.dailyCap = patch.dailyCap;
    }
    const invalid =
      validateText(patch.brief, 'brief', settings.maxBriefChars) ??
      validateText(patch.description, 'description', DESCRIPTION_MAX);
    if (invalid) {
      return { ok: false, error: invalid };
    }
    if (patch.brief !== undefined) {
      next.brief = patch.brief;
    }
    if (patch.description !== undefined) {
      next.description = patch.description;
    }
    if (patch.enabled !== undefined) {
      next.enabled = patch.enabled;
    }
    if (patch.agentId !== undefined) {
      if (!(await checkAgent(actor, patch.agentId))) {
        return fail('ROLE_AGENT_UNAVAILABLE', { field: 'agentId' });
      }
      next.agentId = patch.agentId;
    }
    const updated = await methods.updateBridgeRole(actor.id, id, next);
    return updated ? ok(toRole(updated)) : fail('ROLE_NOT_FOUND');
  }

  async function deleteRole(userId: string, id: string): Promise<RolesResult<true>> {
    return (await methods.deleteBridgeRole(userId, id)) ? ok(true) : fail('ROLE_NOT_FOUND');
  }

  /** Brings a run's stored status in line with what the job manager knows. */
  async function refreshRun(
    userId: string,
    run: BridgeRunRecord,
    at: Date,
  ): Promise<BridgeRunRecord> {
    if (TERMINAL.has(run.status)) {
      return run;
    }
    let job: JobStatus | null | undefined;
    try {
      job = await deps.getJobStatus(run.conversationId);
    } catch {
      return run;
    }
    let status: BridgeRunStatusValue;
    let error: string | undefined;
    switch (job) {
      case 'running':
        status = 'running';
        break;
      case 'requires_action':
        status = 'paused';
        break;
      case 'complete':
        status = 'done';
        break;
      case 'error':
        status = 'failed';
        error = 'run_error';
        break;
      case 'aborted':
        status = 'failed';
        error = 'aborted';
        break;
      default:
        status = at.getTime() - run.createdAt.getTime() > UNKNOWN_AFTER_MS ? 'unknown' : 'queued';
    }
    if (status === run.status) {
      return run;
    }
    const updated = await methods.updateBridgeRun(userId, run.id, {
      status,
      ...(error ? { error } : {}),
      ...(TERMINAL.has(status) ? { finishedAt: at } : {}),
    });
    return updated ?? run;
  }

  async function overview(userId: string): Promise<TBridgeRolesOverview> {
    const settings = deps.getSettings().roles;
    const at = now();
    const [roles, recent, usage] = await Promise.all([
      methods.listBridgeRoles(userId),
      methods.listBridgeRuns(userId, { limit: RUNS_SHOWN }),
      methods.getBridgeUsage(userId, dayOf(at)),
    ]);
    const runs = await Promise.all(recent.map((run) => refreshRun(userId, run, at)));
    const byRole: Record<string, { used: number; cap: number }> = {};
    for (const role of roles) {
      byRole[role.id] = {
        used: usage.byRole[role.id] ?? 0,
        cap: role.dailyCap ?? settings.dailyCapPerRole,
      };
    }
    return {
      roles: roles.map(toRole),
      templates: BRIDGE_ROLE_TEMPLATES.map((t) => ({ ...t })),
      runs: runs.map(toRun),
      usage: { day: dayOf(at), team: { used: usage.team, cap: settings.dailyCapTeam }, byRole },
      limits: { maxBriefChars: settings.maxBriefChars, maxRoles: settings.maxRoles },
      fileRolesEnabled: settings.fileRolesEnabled,
    };
  }

  async function assign(
    actor: RolesActor,
    roleId: string,
    request: { requestId: string; task: string },
  ): Promise<RolesResult<TBridgeAssignResponse>> {
    const settings = deps.getSettings();
    const userId = actor.id;
    const role = await methods.getBridgeRole(userId, roleId);
    if (!role) {
      return fail('ROLE_NOT_FOUND');
    }
    if (!role.enabled) {
      return fail('ROLE_DISABLED');
    }
    if (role.runtime !== 'app' || !role.agentId) {
      return fail('ROLE_LOCKED');
    }
    const task = request.task?.trim() ?? '';
    if (task.length === 0 || task.length > settings.maxTaskChars) {
      return fail('ROLE_INVALID', { field: 'task' });
    }
    if (
      typeof request.requestId !== 'string' ||
      request.requestId.length < 8 ||
      request.requestId.length > 100
    ) {
      return fail('ROLE_INVALID', { field: 'requestId' });
    }
    if (looksLikeSecret(task)) {
      return fail('ROLE_SECRET_DETECTED', { field: 'task' });
    }

    const at = now();
    const deliveryId = `bridge:${request.requestId}`;
    const recent = await methods.listBridgeRuns(userId, { limit: settings.roles.assignPerHour });
    const replay = recent.find((run) => run.deliveryId === deliveryId);
    if (replay) {
      return ok({ run: toRun(await refreshRun(userId, replay, at)), replayed: true });
    }
    const windowStart = at.getTime() - HOUR_MS;
    if (
      recent.length >= settings.roles.assignPerHour &&
      recent[recent.length - 1].createdAt.getTime() > windowStart
    ) {
      return fail('ASSIGN_RATE_LIMITED', { cap: settings.roles.assignPerHour });
    }

    const agent = await deps.resolveAgent(actor, role.agentId);
    if (!agent) {
      return fail('ROLE_AGENT_UNAVAILABLE');
    }

    const counted = agent.provider === COUNTED_PROVIDER;
    const conversationId = newId();
    const reserved = await methods.reserveBridgeRun(
      userId,
      {
        roleId: role.id,
        roleSlug: role.slug,
        agentId: agent.id,
        deliveryId,
        conversationId,
        summary: task.replace(/\s+/g, ' ').slice(0, SUMMARY_CHARS),
        counted,
        ...(agent.provider ? { provider: agent.provider } : {}),
        ...(agent.model ? { model: agent.model } : {}),
        day: dayOf(at),
      },
      counted
        ? {
            role: role.dailyCap ?? settings.roles.dailyCapPerRole,
            team: settings.roles.dailyCapTeam,
          }
        : undefined,
    );
    if (!reserved.ok) {
      return fail(reserved.code === 'cap_role' ? 'CAP_ROLE' : 'CAP_TEAM', {
        used: reserved.used,
        cap: reserved.cap,
      });
    }
    if (!reserved.created) {
      return ok({ run: toRun(reserved.run), replayed: true });
    }

    try {
      const envelope = createAgentTriggerEnvelope({
        mode: 'fire',
        requestId: newId(),
        deliveryId,
        receivedAt: at.getTime(),
        principal: {
          id: actor.id,
          ...(actor.role != null && { role: actor.role }),
          ...(actor.tenantId != null && { tenantId: actor.tenantId }),
        },
        target: { agentId: agent.id },
        event: {
          id: deliveryId,
          type: 'bridge.assignment',
          occurredAt: at.getTime(),
          source: { id: role.id, type: 'bridge-role' },
        },
        input: composeInput(role, task),
        run: { conversationId, metadata: { bridgeRunId: reserved.run.id, roleId: role.id } },
      });
      await deps.enqueueTrigger(envelope, { orderingKey: `bridge:${role.id}` });
    } catch (error) {
      if (definiteEnqueueFailure(error)) {
        await methods.updateBridgeRun(userId, reserved.run.id, {
          status: 'failed',
          error: 'enqueue_failed',
          counted: false,
          finishedAt: now(),
        });
        return fail('ASSIGN_FAILED');
      }
      // The delivery may have been stored before the error: keep the slot and let the status settle.
      await methods.updateBridgeRun(userId, reserved.run.id, {
        status: 'unknown',
        error: 'enqueue_unconfirmed',
      });
      return fail('ASSIGN_FAILED');
    }
    return ok({ run: toRun(reserved.run), replayed: false });
  }

  return { createRole, updateRole, deleteRole, overview, assign };
}

export type RolesService = ReturnType<typeof createRolesService>;
