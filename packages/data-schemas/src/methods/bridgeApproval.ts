import { Types } from 'mongoose';
import type {
  BridgeAuditInput,
  BridgeAuditRecord,
  BridgeProposalCreateResult,
  BridgeProposalDecideResult,
  BridgeProposalDecision,
  BridgeProposalInput,
  BridgeProposalRecord,
  BridgeProposalStatusValue,
} from '~/types/bridge';
import type { IBridgeProposal } from '~/schema/bridgeProposal';
import type { IBridgeAudit } from '~/schema/bridgeAudit';

const MAX_LIST = 100;

const isId = (value: string): boolean =>
  typeof value === 'string' &&
  Types.ObjectId.isValid(value) &&
  String(new Types.ObjectId(value)) === value;

const isDuplicate = (error: unknown): boolean =>
  (error as { code?: number } | null)?.code === 11000;

type ProposalDoc = Pick<
  IBridgeProposal,
  | 'source'
  | 'roleSlug'
  | 'runtime'
  | 'title'
  | 'content'
  | 'hash'
  | 'status'
  | 'expiresAt'
  | 'createdAt'
  | 'updatedAt'
> &
  Partial<Pick<IBridgeProposal, 'dedupeKey' | 'originTaskId' | 'decidedAt' | 'decidedBy'>> & {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    roleId: Types.ObjectId;
    runId?: Types.ObjectId;
  };

function toProposal(doc: ProposalDoc): BridgeProposalRecord {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    source: doc.source,
    roleId: String(doc.roleId),
    roleSlug: doc.roleSlug,
    runtime: doc.runtime,
    title: doc.title,
    content: doc.content,
    hash: doc.hash,
    status: doc.status,
    ...(doc.dedupeKey ? { dedupeKey: doc.dedupeKey } : {}),
    ...(doc.originTaskId ? { originTaskId: doc.originTaskId } : {}),
    ...(doc.runId ? { runId: String(doc.runId) } : {}),
    expiresAt: doc.expiresAt,
    ...(doc.decidedAt ? { decidedAt: doc.decidedAt } : {}),
    ...(doc.decidedBy ? { decidedBy: doc.decidedBy } : {}),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

type AuditDoc = Pick<IBridgeAudit, 'action' | 'actor' | 'createdAt'> &
  Partial<Pick<IBridgeAudit, 'roleSlug' | 'hash' | 'detail'>> & {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    proposalId?: Types.ObjectId;
  };

function toAudit(doc: AuditDoc): BridgeAuditRecord {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    action: doc.action,
    ...(doc.proposalId ? { proposalId: String(doc.proposalId) } : {}),
    actor: doc.actor,
    ...(doc.roleSlug ? { roleSlug: doc.roleSlug } : {}),
    ...(doc.hash ? { hash: doc.hash } : {}),
    ...(doc.detail ? { detail: doc.detail } : {}),
    createdAt: doc.createdAt,
  };
}

export interface BridgeApprovalMethods {
  /**
   * Records a proposal. The row is written first and the person's pending ones are counted back, so
   * two at once cannot both slip under `maxPending`; a row over the cap is removed again. A repeated
   * `dedupeKey` returns the proposal it already made.
   */
  createBridgeProposal(
    userId: string,
    input: BridgeProposalInput,
    maxPending: number,
    now?: Date,
  ): Promise<BridgeProposalCreateResult>;
  getBridgeProposal(userId: string, id: string): Promise<BridgeProposalRecord | null>;
  listBridgeProposals(
    userId: string,
    options?: { status?: BridgeProposalStatusValue; limit?: number },
  ): Promise<BridgeProposalRecord[]>;
  /** Proposals still waiting and not yet past their time. */
  countPendingBridgeProposals(userId: string, now?: Date): Promise<number>;
  /**
   * One atomic step from `pending`. An approval must name the hash the person was shown. A repeat of
   * the decision a proposal already has is not an error and changes nothing.
   */
  decideBridgeProposal(
    userId: string,
    id: string,
    decision: BridgeProposalDecision,
    by: string,
    expectedHash?: string,
    now?: Date,
  ): Promise<BridgeProposalDecideResult>;
  /** Notes the run an approved proposal started, once. Returns null if it cannot be set. */
  linkBridgeProposalRun(
    userId: string,
    id: string,
    runId: string,
  ): Promise<BridgeProposalRecord | null>;
  /** Moves every pending proposal past its time to `expired`; returns the ones moved. */
  expireBridgeProposals(userId: string, now?: Date): Promise<BridgeProposalRecord[]>;
  appendBridgeAudit(userId: string, input: BridgeAuditInput): Promise<BridgeAuditRecord>;
  listBridgeAudit(
    userId: string,
    options?: { proposalId?: string; limit?: number },
  ): Promise<BridgeAuditRecord[]>;
}

export function createBridgeApprovalMethods(
  mongoose: typeof import('mongoose'),
): BridgeApprovalMethods {
  const Proposal = () => mongoose.models.BridgeProposal;
  const Audit = () => mongoose.models.BridgeAudit;

  async function createBridgeProposal(
    userId: string,
    input: BridgeProposalInput,
    maxPending: number,
    now: Date = new Date(),
  ): Promise<BridgeProposalCreateResult> {
    const owner = new Types.ObjectId(userId);
    const findExisting = async (): Promise<BridgeProposalRecord | null> => {
      if (!input.dedupeKey) {
        return null;
      }
      const found = await Proposal().findOne({ userId: owner, dedupeKey: input.dedupeKey }).lean();
      return found ? toProposal(found as unknown as ProposalDoc) : null;
    };

    const existing = await findExisting();
    if (existing) {
      return { ok: true, proposal: existing, created: false };
    }

    let created;
    try {
      created = await Proposal().create({
        userId: owner,
        source: input.source,
        roleId: new Types.ObjectId(input.roleId),
        roleSlug: input.roleSlug,
        runtime: input.runtime,
        title: input.title,
        content: input.content,
        hash: input.hash,
        status: 'pending',
        ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
        ...(input.originTaskId ? { originTaskId: input.originTaskId } : {}),
        expiresAt: input.expiresAt,
      });
    } catch (error) {
      if (isDuplicate(error)) {
        const again = await findExisting();
        if (again) {
          return { ok: true, proposal: again, created: false };
        }
      }
      throw error;
    }

    const pending = await countPendingBridgeProposals(userId, now);
    if (pending > maxPending) {
      await Proposal().deleteOne({ _id: created._id });
      return { ok: false, code: 'limit', pending: pending - 1, cap: maxPending };
    }
    return { ok: true, proposal: toProposal(created.toObject() as ProposalDoc), created: true };
  }

  async function getBridgeProposal(
    userId: string,
    id: string,
  ): Promise<BridgeProposalRecord | null> {
    if (!isId(id)) {
      return null;
    }
    const doc = await Proposal()
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .lean();
    return doc ? toProposal(doc as unknown as ProposalDoc) : null;
  }

  async function listBridgeProposals(
    userId: string,
    options: { status?: BridgeProposalStatusValue; limit?: number } = {},
  ): Promise<BridgeProposalRecord[]> {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    if (options.status !== undefined) {
      filter.status = options.status;
    }
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), MAX_LIST);
    const docs = await Proposal().find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
    return docs.map((doc) => toProposal(doc as unknown as ProposalDoc));
  }

  async function countPendingBridgeProposals(
    userId: string,
    now: Date = new Date(),
  ): Promise<number> {
    return Proposal().countDocuments({
      userId: new Types.ObjectId(userId),
      status: 'pending',
      expiresAt: { $gt: now },
    });
  }

  async function decideBridgeProposal(
    userId: string,
    id: string,
    decision: BridgeProposalDecision,
    by: string,
    expectedHash?: string,
    now: Date = new Date(),
  ): Promise<BridgeProposalDecideResult> {
    if (!isId(id)) {
      return { ok: false, code: 'not_found' };
    }
    const owner = new Types.ObjectId(userId);
    const target: BridgeProposalStatusValue = decision === 'approve' ? 'approved' : 'denied';
    const current = await Proposal().findOne({ _id: id, userId: owner }).lean();
    if (!current) {
      return { ok: false, code: 'not_found' };
    }
    const before = current as unknown as ProposalDoc;
    if (before.status === target) {
      return { ok: true, proposal: toProposal(before), changed: false };
    }
    if (before.status !== 'pending') {
      return { ok: false, code: 'not_pending' };
    }
    if (before.expiresAt <= now) {
      await Proposal().updateOne(
        { _id: id, userId: owner, status: 'pending' },
        { $set: { status: 'expired', decidedAt: now } },
      );
      return { ok: false, code: 'expired' };
    }
    if (decision === 'approve' && expectedHash !== before.hash) {
      return { ok: false, code: 'hash_mismatch' };
    }

    const moved = await Proposal()
      .findOneAndUpdate(
        {
          _id: id,
          userId: owner,
          status: 'pending',
          expiresAt: { $gt: now },
          ...(decision === 'approve' ? { hash: expectedHash } : {}),
        },
        { $set: { status: target, decidedAt: now, decidedBy: by } },
        { new: true },
      )
      .lean();
    if (moved) {
      return { ok: true, proposal: toProposal(moved as unknown as ProposalDoc), changed: true };
    }
    // Someone else decided between the read and the write: report what is there now.
    const after = await Proposal().findOne({ _id: id, userId: owner }).lean();
    if (after && (after as unknown as ProposalDoc).status === target) {
      return { ok: true, proposal: toProposal(after as unknown as ProposalDoc), changed: false };
    }
    return { ok: false, code: 'not_pending' };
  }

  async function linkBridgeProposalRun(
    userId: string,
    id: string,
    runId: string,
  ): Promise<BridgeProposalRecord | null> {
    if (!isId(id) || !isId(runId)) {
      return null;
    }
    const doc = await Proposal()
      .findOneAndUpdate(
        {
          _id: id,
          userId: new Types.ObjectId(userId),
          status: 'approved',
          runId: { $exists: false },
        },
        { $set: { runId: new Types.ObjectId(runId) } },
        { new: true },
      )
      .lean();
    return doc ? toProposal(doc as unknown as ProposalDoc) : null;
  }

  async function expireBridgeProposals(
    userId: string,
    now: Date = new Date(),
  ): Promise<BridgeProposalRecord[]> {
    const owner = new Types.ObjectId(userId);
    const due = await Proposal()
      .find({ userId: owner, status: 'pending', expiresAt: { $lte: now } })
      .limit(MAX_LIST)
      .lean();
    const moved: BridgeProposalRecord[] = [];
    for (const row of due) {
      const doc = await Proposal()
        .findOneAndUpdate(
          { _id: (row as { _id: Types.ObjectId })._id, userId: owner, status: 'pending' },
          { $set: { status: 'expired', decidedAt: now } },
          { new: true },
        )
        .lean();
      if (doc) {
        moved.push(toProposal(doc as unknown as ProposalDoc));
      }
    }
    return moved;
  }

  async function appendBridgeAudit(
    userId: string,
    input: BridgeAuditInput,
  ): Promise<BridgeAuditRecord> {
    const doc = await Audit().create({
      userId: new Types.ObjectId(userId),
      action: input.action,
      ...(input.proposalId && isId(input.proposalId)
        ? { proposalId: new Types.ObjectId(input.proposalId) }
        : {}),
      actor: input.actor,
      ...(input.roleSlug ? { roleSlug: input.roleSlug } : {}),
      ...(input.hash ? { hash: input.hash } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
    });
    return toAudit(doc.toObject() as AuditDoc);
  }

  async function listBridgeAudit(
    userId: string,
    options: { proposalId?: string; limit?: number } = {},
  ): Promise<BridgeAuditRecord[]> {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    if (options.proposalId !== undefined) {
      if (!isId(options.proposalId)) {
        return [];
      }
      filter.proposalId = new Types.ObjectId(options.proposalId);
    }
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), MAX_LIST);
    const docs = await Audit().find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
    return docs.map((doc) => toAudit(doc as unknown as AuditDoc));
  }

  return {
    createBridgeProposal,
    getBridgeProposal,
    listBridgeProposals,
    countPendingBridgeProposals,
    decideBridgeProposal,
    linkBridgeProposalRun,
    expireBridgeProposals,
    appendBridgeAudit,
    listBridgeAudit,
  };
}
