import { Types } from 'mongoose';
import type {
  BridgeRoleCreateResult,
  BridgeRoleInput,
  BridgeRolePatch,
  BridgeRoleRecord,
  BridgeRunCaps,
  BridgeRunInput,
  BridgeRunPatch,
  BridgeRunRecord,
  BridgeRunReserveResult,
  BridgeUsageRecord,
} from '~/types/bridge';
import type { IBridgeRole } from '~/schema/bridgeRole';
import type { IBridgeRun } from '~/schema/bridgeRun';

const MAX_LIST = 100;

const isId = (value: string): boolean =>
  typeof value === 'string' &&
  Types.ObjectId.isValid(value) &&
  String(new Types.ObjectId(value)) === value;

const isDuplicate = (error: unknown): boolean =>
  (error as { code?: number } | null)?.code === 11000;

type RoleDoc = Pick<
  IBridgeRole,
  | 'slug'
  | 'name'
  | 'description'
  | 'runtime'
  | 'brief'
  | 'tier'
  | 'enabled'
  | 'createdAt'
  | 'updatedAt'
> &
  Partial<Pick<IBridgeRole, 'agentId' | 'dailyCap' | 'templateId'>> & {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
  };

function toRole(doc: RoleDoc): BridgeRoleRecord {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    slug: doc.slug,
    name: doc.name,
    description: doc.description ?? '',
    runtime: doc.runtime,
    ...(doc.agentId ? { agentId: doc.agentId } : {}),
    brief: doc.brief ?? '',
    tier: doc.tier === 1 ? 1 : 0,
    ...(doc.dailyCap != null ? { dailyCap: doc.dailyCap } : {}),
    enabled: doc.enabled !== false,
    ...(doc.templateId ? { templateId: doc.templateId } : {}),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

type RunDoc = Pick<
  IBridgeRun,
  | 'roleSlug'
  | 'agentId'
  | 'deliveryId'
  | 'conversationId'
  | 'summary'
  | 'status'
  | 'counted'
  | 'day'
  | 'createdAt'
  | 'updatedAt'
> &
  Partial<Pick<IBridgeRun, 'provider' | 'modelName' | 'error' | 'finishedAt'>> & {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    roleId: Types.ObjectId;
  };

function toRun(doc: RunDoc): BridgeRunRecord {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    roleId: String(doc.roleId),
    roleSlug: doc.roleSlug,
    agentId: doc.agentId,
    deliveryId: doc.deliveryId,
    conversationId: doc.conversationId,
    summary: doc.summary ?? '',
    status: doc.status,
    counted: doc.counted === true,
    ...(doc.provider ? { provider: doc.provider } : {}),
    ...(doc.modelName ? { model: doc.modelName } : {}),
    day: doc.day,
    ...(doc.error ? { error: doc.error } : {}),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    ...(doc.finishedAt ? { finishedAt: doc.finishedAt } : {}),
  };
}

export interface BridgeMethods {
  createBridgeRole(
    userId: string,
    input: BridgeRoleInput,
    maxRoles: number,
  ): Promise<BridgeRoleCreateResult>;
  getBridgeRole(userId: string, id: string): Promise<BridgeRoleRecord | null>;
  listBridgeRoles(userId: string): Promise<BridgeRoleRecord[]>;
  updateBridgeRole(
    userId: string,
    id: string,
    patch: BridgeRolePatch,
  ): Promise<BridgeRoleRecord | null>;
  deleteBridgeRole(userId: string, id: string): Promise<boolean>;
  /**
   * Records a hand-over before it is sent, so two at once cannot both slip under a cap: the row is
   * written first, the day's counted runs are read back, and a row over a cap is removed again. A
   * repeated `deliveryId` returns the run it already made.
   */
  reserveBridgeRun(
    userId: string,
    input: BridgeRunInput,
    caps?: BridgeRunCaps,
  ): Promise<BridgeRunReserveResult>;
  updateBridgeRun(
    userId: string,
    id: string,
    patch: BridgeRunPatch,
  ): Promise<BridgeRunRecord | null>;
  getBridgeRun(userId: string, id: string): Promise<BridgeRunRecord | null>;
  listBridgeRuns(
    userId: string,
    options?: { roleId?: string; limit?: number },
  ): Promise<BridgeRunRecord[]>;
  latestBridgeRuns(userId: string, roleIds: string[]): Promise<Record<string, BridgeRunRecord>>;
  getBridgeUsage(userId: string, day: string): Promise<BridgeUsageRecord>;
}

export function createBridgeMethods(mongoose: typeof import('mongoose')): BridgeMethods {
  const Role = () => mongoose.models.BridgeRole;
  const Run = () => mongoose.models.BridgeRun;

  async function createBridgeRole(
    userId: string,
    input: BridgeRoleInput,
    maxRoles: number,
  ): Promise<BridgeRoleCreateResult> {
    const owner = new Types.ObjectId(userId);
    if ((await Role().countDocuments({ userId: owner })) >= maxRoles) {
      return { ok: false, code: 'limit' };
    }
    try {
      const doc = await Role().create({
        userId: owner,
        slug: input.slug,
        name: input.name,
        description: input.description ?? '',
        runtime: input.runtime,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        brief: input.brief ?? '',
        tier: input.tier ?? 0,
        ...(input.dailyCap != null ? { dailyCap: input.dailyCap } : {}),
        enabled: input.enabled ?? true,
        ...(input.templateId ? { templateId: input.templateId } : {}),
      });
      return { ok: true, role: toRole(doc.toObject() as RoleDoc) };
    } catch (error) {
      if (isDuplicate(error)) {
        return { ok: false, code: 'slug_taken' };
      }
      throw error;
    }
  }

  async function getBridgeRole(userId: string, id: string): Promise<BridgeRoleRecord | null> {
    if (!isId(id)) {
      return null;
    }
    const doc = await Role()
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .lean();
    return doc ? toRole(doc as unknown as RoleDoc) : null;
  }

  async function listBridgeRoles(userId: string): Promise<BridgeRoleRecord[]> {
    const docs = await Role()
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    return docs.map((doc) => toRole(doc as unknown as RoleDoc));
  }

  async function updateBridgeRole(
    userId: string,
    id: string,
    patch: BridgeRolePatch,
  ): Promise<BridgeRoleRecord | null> {
    if (!isId(id)) {
      return null;
    }
    const { dailyCap, ...rest } = patch;
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) {
        set[key] = value;
      }
    }
    const update: Record<string, unknown> = {};
    if (dailyCap !== undefined && dailyCap !== null) {
      set.dailyCap = dailyCap;
    }
    if (Object.keys(set).length > 0) {
      update.$set = set;
    }
    if (dailyCap === null) {
      update.$unset = { dailyCap: '' };
    }
    const doc = await Role()
      .findOneAndUpdate({ _id: id, userId: new Types.ObjectId(userId) }, update, {
        new: true,
        runValidators: true,
      })
      .lean();
    return doc ? toRole(doc as unknown as RoleDoc) : null;
  }

  async function deleteBridgeRole(userId: string, id: string): Promise<boolean> {
    if (!isId(id)) {
      return false;
    }
    const result = await Role().deleteOne({ _id: id, userId: new Types.ObjectId(userId) });
    return result.deletedCount === 1;
  }

  async function reserveBridgeRun(
    userId: string,
    input: BridgeRunInput,
    caps?: BridgeRunCaps,
  ): Promise<BridgeRunReserveResult> {
    const owner = new Types.ObjectId(userId);
    const findExisting = async (): Promise<BridgeRunRecord | null> => {
      const found = await Run().findOne({ userId: owner, deliveryId: input.deliveryId }).lean();
      return found ? toRun(found as unknown as RunDoc) : null;
    };

    const existing = await findExisting();
    if (existing) {
      return { ok: true, run: existing, created: false };
    }

    const roleId = new Types.ObjectId(input.roleId);
    let created;
    try {
      created = await Run().create({
        userId: owner,
        roleId,
        roleSlug: input.roleSlug,
        agentId: input.agentId,
        deliveryId: input.deliveryId,
        conversationId: input.conversationId,
        summary: input.summary,
        status: 'queued',
        counted: input.counted,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { modelName: input.model } : {}),
        day: input.day,
      });
    } catch (error) {
      if (isDuplicate(error)) {
        const again = await findExisting();
        if (again) {
          return { ok: true, run: again, created: false };
        }
      }
      throw error;
    }

    if (input.counted && caps) {
      const used = async (scope: Record<string, unknown>): Promise<number> =>
        Run().countDocuments({ userId: owner, day: input.day, counted: true, ...scope });
      if (caps.role !== undefined) {
        const roleUsed = await used({ roleId });
        if (roleUsed > caps.role) {
          await Run().deleteOne({ _id: created._id });
          return { ok: false, code: 'cap_role', used: roleUsed - 1, cap: caps.role };
        }
      }
      if (caps.team !== undefined) {
        const teamUsed = await used({});
        if (teamUsed > caps.team) {
          await Run().deleteOne({ _id: created._id });
          return { ok: false, code: 'cap_team', used: teamUsed - 1, cap: caps.team };
        }
      }
    }
    return { ok: true, run: toRun(created.toObject() as RunDoc), created: true };
  }

  async function updateBridgeRun(
    userId: string,
    id: string,
    patch: BridgeRunPatch,
  ): Promise<BridgeRunRecord | null> {
    if (!isId(id)) {
      return null;
    }
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        set[key] = value;
      }
    }
    const doc = await Run()
      .findOneAndUpdate(
        { _id: id, userId: new Types.ObjectId(userId) },
        { $set: set },
        { new: true, runValidators: true },
      )
      .lean();
    return doc ? toRun(doc as unknown as RunDoc) : null;
  }

  async function getBridgeRun(userId: string, id: string): Promise<BridgeRunRecord | null> {
    if (!isId(id)) {
      return null;
    }
    const doc = await Run()
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .lean();
    return doc ? toRun(doc as unknown as RunDoc) : null;
  }

  async function listBridgeRuns(
    userId: string,
    options: { roleId?: string; limit?: number } = {},
  ): Promise<BridgeRunRecord[]> {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    if (options.roleId !== undefined) {
      if (!isId(options.roleId)) {
        return [];
      }
      filter.roleId = new Types.ObjectId(options.roleId);
    }
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), MAX_LIST);
    const docs = await Run().find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
    return docs.map((doc) => toRun(doc as unknown as RunDoc));
  }

  async function latestBridgeRuns(
    userId: string,
    roleIds: string[],
  ): Promise<Record<string, BridgeRunRecord>> {
    const ids = roleIds.filter(isId).map((id) => new Types.ObjectId(id));
    if (ids.length === 0) {
      return {};
    }
    const rows = await Run().aggregate([
      { $match: { userId: new Types.ObjectId(userId), roleId: { $in: ids } } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: '$roleId', run: { $first: '$$ROOT' } } },
    ]);
    const out: Record<string, BridgeRunRecord> = {};
    for (const row of rows as Array<{ _id: Types.ObjectId; run: RunDoc }>) {
      out[String(row._id)] = toRun(row.run);
    }
    return out;
  }

  async function getBridgeUsage(userId: string, day: string): Promise<BridgeUsageRecord> {
    const rows = await Run().aggregate([
      { $match: { userId: new Types.ObjectId(userId), day, counted: true } },
      { $group: { _id: '$roleId', used: { $sum: 1 } } },
    ]);
    const byRole: Record<string, number> = {};
    let team = 0;
    for (const row of rows as Array<{ _id: Types.ObjectId; used: number }>) {
      byRole[String(row._id)] = row.used;
      team += row.used;
    }
    return { team, byRole };
  }

  return {
    createBridgeRole,
    getBridgeRole,
    listBridgeRoles,
    updateBridgeRole,
    deleteBridgeRole,
    reserveBridgeRun,
    updateBridgeRun,
    getBridgeRun,
    listBridgeRuns,
    latestBridgeRuns,
    getBridgeUsage,
  };
}
