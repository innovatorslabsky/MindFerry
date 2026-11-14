import { createHash } from 'node:crypto';
import type {
  TBridgeApprovalsErrorCode,
  TBridgeApprovalsOverview,
  TBridgeAssignResponse,
  TBridgeAuditLine,
  TBridgeDecideResponse,
  TBridgeProposal,
  TBridgeProposalInput,
  TBridgeRolesErrorCode,
  TBridgeRun,
} from 'librechat-data-provider';
import type {
  BridgeApprovalMethods,
  BridgeAuditRecord,
  BridgeMethods,
  BridgeProposalRecord,
} from '@librechat/data-schemas';
import type { RolesActor, RolesFailure, RolesResult } from '../roles/service';
import type { BridgeSettings } from '../config';
import { looksLikeSecret } from '../secrets';
import { toOneLine } from '../protocol';

export type ApprovalsFailure = {
  code: TBridgeApprovalsErrorCode;
  field?: string;
  cap?: number;
  cause?: TBridgeRolesErrorCode;
  proposal?: TBridgeProposal;
};
export type ApprovalsResult<T> = { ok: true; value: T } | { ok: false; error: ApprovalsFailure };

export type ApprovalMethods = Pick<
  BridgeApprovalMethods,
  | 'createBridgeProposal'
  | 'getBridgeProposal'
  | 'listBridgeProposals'
  | 'countPendingBridgeProposals'
  | 'decideBridgeProposal'
  | 'linkBridgeProposalRun'
  | 'expireBridgeProposals'
  | 'appendBridgeAudit'
  | 'listBridgeAudit'
> &
  Pick<BridgeMethods, 'getBridgeRole'>;

export interface ApprovalsDeps {
  methods: ApprovalMethods;
  getSettings: () => BridgeSettings;
  /** Hands approved work to its role: the roles service's `assign`, with its caps and checks. */
  handOver: (
    actor: RolesActor,
    roleId: string,
    request: { requestId: string; task: string },
  ) => Promise<RolesResult<TBridgeAssignResponse>>;
  now?: () => Date;
}

const TITLE_CHARS = 140;
const HOUR_MS = 60 * 60 * 1000;
const HASH = /^[0-9a-f]{64}$/;

const fail = <T>(
  code: TBridgeApprovalsErrorCode,
  extra: Omit<ApprovalsFailure, 'code'> = {},
): ApprovalsResult<T> => ({ ok: false, error: { code, ...extra } });
const ok = <T>(value: T): ApprovalsResult<T> => ({ ok: true, value });

/** Ties an approval to the role and the exact text that were shown. */
export function proposalHash(roleId: string, content: string): string {
  return createHash('sha256').update(`bridge-proposal-v1\n${roleId}\n${content}`).digest('hex');
}

const DECIDE_FAILURE: Record<
  'not_found' | 'not_pending' | 'hash_mismatch',
  TBridgeApprovalsErrorCode
> = {
  not_found: 'APPROVAL_NOT_FOUND',
  not_pending: 'APPROVAL_NOT_PENDING',
  hash_mismatch: 'APPROVAL_HASH_MISMATCH',
};

const actorName = (actor: RolesActor): string => `user:${actor.id}`;

export function toProposal(record: BridgeProposalRecord): TBridgeProposal {
  return {
    id: record.id,
    source: record.source,
    roleId: record.roleId,
    roleSlug: record.roleSlug,
    runtime: record.runtime,
    title: record.title,
    content: record.content,
    hash: record.hash,
    status: record.status,
    ...(record.originTaskId ? { originTaskId: record.originTaskId } : {}),
    ...(record.runId ? { runId: record.runId } : {}),
    expiresAt: record.expiresAt.toISOString(),
    ...(record.decidedAt ? { decidedAt: record.decidedAt.toISOString() } : {}),
    createdAt: record.createdAt.toISOString(),
  };
}

function toLine(record: BridgeAuditRecord): TBridgeAuditLine {
  return {
    id: record.id,
    action: record.action,
    ...(record.proposalId ? { proposalId: record.proposalId } : {}),
    actor: record.actor,
    ...(record.roleSlug ? { roleSlug: record.roleSlug } : {}),
    ...(record.hash ? { hash: record.hash } : {}),
    ...(record.detail ? { detail: record.detail } : {}),
    createdAt: record.createdAt.toISOString(),
  };
}

export interface ApprovalsService {
  overview: (userId: string) => Promise<TBridgeApprovalsOverview>;
  create: (
    actor: RolesActor,
    input: TBridgeProposalInput,
  ) => Promise<ApprovalsResult<TBridgeProposal>>;
  decide: (
    actor: RolesActor,
    id: string,
    body: { decision: 'approve' | 'deny'; hash?: string },
  ) => Promise<ApprovalsResult<TBridgeDecideResponse>>;
  audit: (userId: string, proposalId?: string) => Promise<TBridgeAuditLine[]>;
}

export function createApprovalsService(deps: ApprovalsDeps): ApprovalsService {
  const { methods } = deps;
  const now = () => (deps.now ? deps.now() : new Date());

  /** Writes a ledger line once per proposal and action, so a retried step does not repeat it. */
  async function ensureAudit(
    userId: string,
    proposal: BridgeProposalRecord,
    action: 'proposal_approved' | 'proposal_expired',
    actor: string,
  ): Promise<void> {
    const lines = await methods.listBridgeAudit(userId, { proposalId: proposal.id, limit: 50 });
    if (lines.some((line) => line.action === action)) {
      return;
    }
    await methods.appendBridgeAudit(userId, {
      action,
      proposalId: proposal.id,
      actor,
      roleSlug: proposal.roleSlug,
      hash: proposal.hash,
    });
  }

  async function overview(userId: string): Promise<TBridgeApprovalsOverview> {
    const settings = deps.getSettings();
    const at = now();
    for (const expired of await methods.expireBridgeProposals(userId, at)) {
      await ensureAudit(userId, expired, 'proposal_expired', 'system');
    }
    const [proposals, pending] = await Promise.all([
      methods.listBridgeProposals(userId, { limit: 50 }),
      methods.countPendingBridgeProposals(userId, at),
    ]);
    return {
      proposals: proposals.map(toProposal),
      pending,
      maxPending: settings.approvals.maxPending,
      expiryHours: settings.approvals.expiryHours,
    };
  }

  async function create(
    actor: RolesActor,
    input: TBridgeProposalInput,
  ): Promise<ApprovalsResult<TBridgeProposal>> {
    const settings = deps.getSettings();
    const task = typeof input.task === 'string' ? input.task.trim() : '';
    if (task.length === 0 || task.length > settings.maxTaskChars) {
      return fail('APPROVAL_INVALID', { field: 'task' });
    }
    if (
      typeof input.requestId !== 'string' ||
      input.requestId.length < 8 ||
      input.requestId.length > 100
    ) {
      return fail('APPROVAL_INVALID', { field: 'requestId' });
    }
    if (looksLikeSecret(task)) {
      return fail('APPROVAL_SECRET_DETECTED', { field: 'task' });
    }
    const role = await methods.getBridgeRole(actor.id, input.roleId);
    if (!role || !role.enabled || (role.runtime !== 'app' && !settings.roles.fileRolesEnabled)) {
      return fail('APPROVAL_ROLE_UNAVAILABLE');
    }
    const at = now();
    const made = await methods.createBridgeProposal(
      actor.id,
      {
        source: 'person',
        roleId: role.id,
        roleSlug: role.slug,
        runtime: role.runtime,
        title: toOneLine(task).slice(0, TITLE_CHARS),
        content: task,
        hash: proposalHash(role.id, task),
        dedupeKey: `person:${input.requestId}`,
        expiresAt: new Date(at.getTime() + settings.approvals.expiryHours * HOUR_MS),
      },
      settings.approvals.maxPending,
      at,
    );
    if (!made.ok) {
      return fail('APPROVAL_LIMIT', { cap: made.cap });
    }
    if (made.created) {
      await methods.appendBridgeAudit(actor.id, {
        action: 'proposal_created',
        proposalId: made.proposal.id,
        actor: actorName(actor),
        roleSlug: made.proposal.roleSlug,
        hash: made.proposal.hash,
      });
    }
    return ok(toProposal(made.proposal));
  }

  async function handOver(
    actor: RolesActor,
    proposal: BridgeProposalRecord,
  ): Promise<ApprovalsResult<TBridgeDecideResponse>> {
    const handed = await deps.handOver(actor, proposal.roleId, {
      requestId: `approval:${proposal.id}`,
      task: proposal.content,
    });
    if (!handed.ok) {
      const cause = (handed.error as RolesFailure).code;
      await methods.appendBridgeAudit(actor.id, {
        action: 'handover_failed',
        proposalId: proposal.id,
        actor: 'system',
        roleSlug: proposal.roleSlug,
        hash: proposal.hash,
        detail: cause,
      });
      return fail('APPROVAL_HANDOVER_FAILED', { cause, proposal: toProposal(proposal) });
    }
    const run: TBridgeRun = handed.value.run;
    const linked = await methods.linkBridgeProposalRun(actor.id, proposal.id, run.id);
    await methods.appendBridgeAudit(actor.id, {
      action: 'handed_over',
      proposalId: proposal.id,
      actor: 'system',
      roleSlug: proposal.roleSlug,
      hash: proposal.hash,
      detail: run.runtime,
    });
    return ok({ proposal: toProposal(linked ?? { ...proposal, runId: run.id }), run });
  }

  async function decide(
    actor: RolesActor,
    id: string,
    body: { decision: 'approve' | 'deny'; hash?: string },
  ): Promise<ApprovalsResult<TBridgeDecideResponse>> {
    const at = now();
    if (body.decision === 'deny') {
      const denied = await methods.decideBridgeProposal(
        actor.id,
        id,
        'deny',
        actorName(actor),
        undefined,
        at,
      );
      if (!denied.ok) {
        return fail(denied.code === 'not_found' ? 'APPROVAL_NOT_FOUND' : 'APPROVAL_NOT_PENDING');
      }
      if (denied.changed) {
        await methods.appendBridgeAudit(actor.id, {
          action: 'proposal_denied',
          proposalId: denied.proposal.id,
          actor: actorName(actor),
          roleSlug: denied.proposal.roleSlug,
          hash: denied.proposal.hash,
        });
      }
      return ok({ proposal: toProposal(denied.proposal) });
    }

    if (typeof body.hash !== 'string' || !HASH.test(body.hash)) {
      return fail('APPROVAL_INVALID', { field: 'hash' });
    }
    const stored = await methods.getBridgeProposal(actor.id, id);
    if (!stored) {
      return fail('APPROVAL_NOT_FOUND');
    }
    // The stored text must still be the text its hash was made from.
    if (proposalHash(stored.roleId, stored.content) !== stored.hash) {
      return fail('APPROVAL_HASH_MISMATCH');
    }
    const approved = await methods.decideBridgeProposal(
      actor.id,
      id,
      'approve',
      actorName(actor),
      body.hash,
      at,
    );
    if (!approved.ok) {
      if (approved.code === 'expired') {
        const after = await methods.getBridgeProposal(actor.id, id);
        if (after) {
          await ensureAudit(actor.id, after, 'proposal_expired', 'system');
        }
        return fail('APPROVAL_EXPIRED');
      }
      return fail(DECIDE_FAILURE[approved.code]);
    }
    const { proposal } = approved;
    if (proposal.runId) {
      return ok({ proposal: toProposal(proposal) });
    }
    // The ledger line comes before the hand-over, and a retry after a crash finds it already there.
    await ensureAudit(actor.id, proposal, 'proposal_approved', actorName(actor));
    return handOver(actor, proposal);
  }

  async function audit(userId: string, proposalId?: string): Promise<TBridgeAuditLine[]> {
    const lines = await methods.listBridgeAudit(userId, {
      ...(proposalId !== undefined ? { proposalId } : {}),
      limit: 100,
    });
    return lines.map(toLine);
  }

  return { overview, create, decide, audit };
}
