import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { BridgeProposalInput } from '~/types/bridge';
import { createBridgeApprovalMethods, type BridgeApprovalMethods } from './bridgeApproval';
import bridgeProposalSchema from '~/schema/bridgeProposal';
import bridgeAuditSchema from '~/schema/bridgeAudit';

let mongoServer: MongoMemoryServer;
let methods: BridgeApprovalMethods;

const userA = new mongoose.Types.ObjectId().toString();
const userB = new mongoose.Types.ObjectId().toString();
const roleId = new mongoose.Types.ObjectId().toString();
const hash = (char: string): string => char.repeat(64);
const NOW = new Date('2026-11-14T10:00:00Z');
const LATER = new Date('2026-11-15T10:00:00Z');
const EARLIER = new Date('2026-11-13T10:00:00Z');

let counter = 0;
const input = (over: Partial<BridgeProposalInput> = {}): BridgeProposalInput => {
  counter += 1;
  return {
    source: 'person',
    roleId,
    roleSlug: 'seo-strategist-petvee',
    runtime: 'hermes',
    title: 'Draft the store listing',
    content: `Draft a Google Play listing, version ${counter}.`,
    hash: hash('a'),
    expiresAt: LATER,
    ...over,
  };
};

async function made(userId = userA, over: Partial<BridgeProposalInput> = {}) {
  const result = await methods.createBridgeProposal(userId, input(over), 50, NOW);
  if (!result.ok) {
    throw new Error(`not created: ${result.code}`);
  }
  return result.proposal;
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  if (!mongoose.models.BridgeProposal) {
    mongoose.model('BridgeProposal', bridgeProposalSchema);
  }
  if (!mongoose.models.BridgeAudit) {
    mongoose.model('BridgeAudit', bridgeAuditSchema);
  }
  await mongoose.connect(mongoServer.getUri());
  await mongoose.models.BridgeProposal.syncIndexes();
  await mongoose.models.BridgeAudit.syncIndexes();
  methods = createBridgeApprovalMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.models.BridgeProposal.deleteMany({});
});

describe('creating a proposal', () => {
  it('stores it pending, with the content and hash it was given', async () => {
    const proposal = await made();
    expect(proposal.status).toBe('pending');
    expect(proposal.hash).toBe(hash('a'));
    expect(proposal.content).toContain('Google Play');
    expect(proposal.userId).toBe(userA);
  });

  it('returns the same proposal for a repeated dedupe key and adds no second one', async () => {
    const first = await made(userA, { dedupeKey: 'task-1:0' });
    const again = await methods.createBridgeProposal(
      userA,
      input({ dedupeKey: 'task-1:0', content: 'different text' }),
      50,
      NOW,
    );
    expect(again.ok && again.created).toBe(false);
    expect(again.ok && again.proposal.id).toBe(first.id);
    expect(again.ok && again.proposal.content).toBe(first.content);
    expect(await methods.listBridgeProposals(userA)).toHaveLength(1);
  });

  it('lets two people use the same dedupe key', async () => {
    await made(userA, { dedupeKey: 'shared' });
    const other = await methods.createBridgeProposal(
      userB,
      input({ dedupeKey: 'shared' }),
      50,
      NOW,
    );
    expect(other.ok && other.created).toBe(true);
  });

  it('refuses over the pending cap, removes the row, and counts only the person’s own', async () => {
    await made(userA);
    await made(userA);
    const over = await methods.createBridgeProposal(userA, input(), 2, NOW);
    expect(over).toEqual({ ok: false, code: 'limit', pending: 2, cap: 2 });
    expect(await methods.listBridgeProposals(userA)).toHaveLength(2);
    const other = await methods.createBridgeProposal(userB, input(), 2, NOW);
    expect(other.ok).toBe(true);
  });

  it('does not count an expired proposal against the cap', async () => {
    await made(userA, { expiresAt: EARLIER });
    const next = await methods.createBridgeProposal(userA, input(), 1, NOW);
    expect(next.ok).toBe(true);
  });

  it('never lets two racing creates go over the cap, though both may be turned away', async () => {
    const results = await Promise.all([
      methods.createBridgeProposal(userA, input(), 1, NOW),
      methods.createBridgeProposal(userA, input(), 1, NOW),
    ]);
    const accepted = results.filter((r) => r.ok).length;
    expect(accepted).toBeLessThanOrEqual(1);
    expect(await methods.listBridgeProposals(userA)).toHaveLength(accepted);
  });

  it('rejects a hash that is not 64 hex characters', async () => {
    await expect(
      methods.createBridgeProposal(userA, input({ hash: 'nothex' }), 50, NOW),
    ).rejects.toThrow();
  });
});

describe('reading proposals', () => {
  it('shows a person only their own', async () => {
    const mine = await made(userA);
    expect(await methods.getBridgeProposal(userB, mine.id)).toBeNull();
    expect(await methods.getBridgeProposal(userA, mine.id)).not.toBeNull();
    expect(await methods.listBridgeProposals(userB)).toEqual([]);
  });

  it('returns null for an id that is not one, and filters by status newest first', async () => {
    expect(await methods.getBridgeProposal(userA, 'nope')).toBeNull();
    const first = await made(userA);
    const second = await made(userA);
    await methods.decideBridgeProposal(userA, first.id, 'deny', `user:${userA}`, undefined, NOW);
    expect(
      (await methods.listBridgeProposals(userA, { status: 'pending' })).map((p) => p.id),
    ).toEqual([second.id]);
    expect((await methods.listBridgeProposals(userA)).map((p) => p.id)).toEqual([
      second.id,
      first.id,
    ]);
  });
});

describe('deciding', () => {
  it('approves once with the hash that was shown, and records who and when', async () => {
    const p = await made();
    const result = await methods.decideBridgeProposal(
      userA,
      p.id,
      'approve',
      'user:x',
      hash('a'),
      NOW,
    );
    expect(result.ok && result.changed).toBe(true);
    expect(result.ok && result.proposal.status).toBe('approved');
    expect(result.ok && result.proposal.decidedBy).toBe('user:x');
    expect(result.ok && result.proposal.decidedAt).toEqual(NOW);
  });

  it('refuses an approval with a different hash, or none, and leaves it pending', async () => {
    const p = await made();
    expect(await methods.decideBridgeProposal(userA, p.id, 'approve', 'u', hash('b'), NOW)).toEqual(
      {
        ok: false,
        code: 'hash_mismatch',
      },
    );
    expect(await methods.decideBridgeProposal(userA, p.id, 'approve', 'u', undefined, NOW)).toEqual(
      {
        ok: false,
        code: 'hash_mismatch',
      },
    );
    expect((await methods.getBridgeProposal(userA, p.id))?.status).toBe('pending');
  });

  it('denies without needing a hash', async () => {
    const p = await made();
    const result = await methods.decideBridgeProposal(userA, p.id, 'deny', 'u', undefined, NOW);
    expect(result.ok && result.proposal.status).toBe('denied');
  });

  it('treats a repeat of the same decision as a no-op, and a different one as not pending', async () => {
    const p = await made();
    await methods.decideBridgeProposal(userA, p.id, 'approve', 'u', hash('a'), NOW);
    const again = await methods.decideBridgeProposal(userA, p.id, 'approve', 'u', hash('a'), NOW);
    expect(again.ok && again.changed).toBe(false);
    expect(await methods.decideBridgeProposal(userA, p.id, 'deny', 'u', undefined, NOW)).toEqual({
      ok: false,
      code: 'not_pending',
    });
  });

  it('lets only one of two simultaneous approvals change anything', async () => {
    const p = await made();
    const [one, two] = await Promise.all([
      methods.decideBridgeProposal(userA, p.id, 'approve', 'u', hash('a'), NOW),
      methods.decideBridgeProposal(userA, p.id, 'approve', 'u', hash('a'), NOW),
    ]);
    const changed = [one, two].filter((r) => r.ok && r.changed);
    expect(changed).toHaveLength(1);
    expect([one, two].every((r) => r.ok)).toBe(true);
  });

  it('lets an approval and a denial at once end in exactly one state', async () => {
    const p = await made();
    const [a, d] = await Promise.all([
      methods.decideBridgeProposal(userA, p.id, 'approve', 'u', hash('a'), NOW),
      methods.decideBridgeProposal(userA, p.id, 'deny', 'u', undefined, NOW),
    ]);
    expect([a, d].filter((r) => r.ok && r.changed)).toHaveLength(1);
    const final = (await methods.getBridgeProposal(userA, p.id))?.status;
    expect(['approved', 'denied']).toContain(final);
  });

  it('does not approve one that is past its time, and marks it expired', async () => {
    const p = await made(userA, { expiresAt: EARLIER });
    expect(await methods.decideBridgeProposal(userA, p.id, 'approve', 'u', hash('a'), NOW)).toEqual(
      {
        ok: false,
        code: 'expired',
      },
    );
    expect((await methods.getBridgeProposal(userA, p.id))?.status).toBe('expired');
  });

  it('will not decide another person’s proposal or an unknown id', async () => {
    const p = await made(userA);
    expect(await methods.decideBridgeProposal(userB, p.id, 'deny', 'u', undefined, NOW)).toEqual({
      ok: false,
      code: 'not_found',
    });
    expect(await methods.decideBridgeProposal(userA, 'nope', 'deny', 'u', undefined, NOW)).toEqual({
      ok: false,
      code: 'not_found',
    });
    expect((await methods.getBridgeProposal(userA, p.id))?.status).toBe('pending');
  });

  it('never changes the content or hash of a proposal', async () => {
    const p = await made();
    await mongoose.models.BridgeProposal.updateOne(
      { _id: p.id },
      { $set: { content: 'changed', hash: hash('c') } },
    );
    const after = await methods.getBridgeProposal(userA, p.id);
    expect(after?.content).toBe(p.content);
    expect(after?.hash).toBe(hash('a'));
  });
});

describe('linking the run and expiring', () => {
  it('links a run once, only to an approved proposal', async () => {
    const p = await made();
    const runId = new mongoose.Types.ObjectId().toString();
    expect(await methods.linkBridgeProposalRun(userA, p.id, runId)).toBeNull();
    await methods.decideBridgeProposal(userA, p.id, 'approve', 'u', hash('a'), NOW);
    const linked = await methods.linkBridgeProposalRun(userA, p.id, runId);
    expect(linked?.runId).toBe(runId);
    expect(
      await methods.linkBridgeProposalRun(userA, p.id, new mongoose.Types.ObjectId().toString()),
    ).toBeNull();
    expect((await methods.getBridgeProposal(userA, p.id))?.runId).toBe(runId);
  });

  it('expires only pending proposals past their time, and reports which', async () => {
    const old = await made(userA, { expiresAt: EARLIER });
    const fresh = await made(userA);
    const done = await made(userA, { expiresAt: EARLIER });
    await mongoose.models.BridgeProposal.updateOne(
      { _id: done.id },
      { $set: { status: 'denied' } },
    );
    const moved = await methods.expireBridgeProposals(userA, NOW);
    expect(moved.map((p) => p.id)).toEqual([old.id]);
    expect((await methods.getBridgeProposal(userA, fresh.id))?.status).toBe('pending');
    expect((await methods.getBridgeProposal(userA, done.id))?.status).toBe('denied');
    expect(await methods.expireBridgeProposals(userA, NOW)).toEqual([]);
  });

  it('counts only pending proposals still in time', async () => {
    await made(userA);
    await made(userA, { expiresAt: EARLIER });
    expect(await methods.countPendingBridgeProposals(userA, NOW)).toBe(1);
  });
});

describe('the audit ledger', () => {
  it('appends lines and lists them newest first, for one person or one proposal', async () => {
    const p = await made();
    await methods.appendBridgeAudit(userA, {
      action: 'proposal_created',
      proposalId: p.id,
      actor: `user:${userA}`,
      roleSlug: p.roleSlug,
      hash: p.hash,
    });
    await methods.appendBridgeAudit(userA, {
      action: 'proposal_approved',
      proposalId: p.id,
      actor: `user:${userA}`,
      hash: p.hash,
      detail: 'ok',
    });
    await methods.appendBridgeAudit(userA, { action: 'proposal_expired', actor: 'system' });
    const all = await methods.listBridgeAudit(userA);
    expect(all.map((l) => l.action)).toEqual([
      'proposal_expired',
      'proposal_approved',
      'proposal_created',
    ]);
    const one = await methods.listBridgeAudit(userA, { proposalId: p.id });
    expect(one).toHaveLength(2);
    expect(one[1].hash).toBe(p.hash);
    expect(await methods.listBridgeAudit(userB)).toEqual([]);
    expect(await methods.listBridgeAudit(userA, { proposalId: 'nope' })).toEqual([]);
  });

  it('refuses to change or remove a line, by any route the application has', async () => {
    const line = await methods.appendBridgeAudit(userA, { action: 'handed_over', actor: 'system' });
    const Audit = mongoose.models.BridgeAudit;
    await expect(Audit.updateOne({ _id: line.id }, { $set: { actor: 'x' } })).rejects.toThrow(
      /append-only/,
    );
    await expect(Audit.updateMany({}, { $set: { actor: 'x' } })).rejects.toThrow(/append-only/);
    await expect(
      Audit.findOneAndUpdate({ _id: line.id }, { $set: { actor: 'x' } }),
    ).rejects.toThrow(/append-only/);
    await expect(Audit.replaceOne({ _id: line.id }, { actor: 'x' })).rejects.toThrow(/append-only/);
    await expect(Audit.deleteOne({ _id: line.id })).rejects.toThrow(/append-only/);
    await expect(Audit.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(Audit.findOneAndDelete({ _id: line.id })).rejects.toThrow(/append-only/);
    const doc = await Audit.findById(line.id);
    doc.actor = 'x';
    await expect(doc.save()).rejects.toThrow(/append-only/);
    const [still] = await methods.listBridgeAudit(userA, { limit: 1 });
    expect(still.actor).toBe('system');
  });

  it('rejects an action it does not know and a hash that is not hex', async () => {
    await expect(
      methods.appendBridgeAudit(userA, { action: 'bogus' as never, actor: 'system' }),
    ).rejects.toThrow();
    await expect(
      methods.appendBridgeAudit(userA, { action: 'handed_over', actor: 'system', hash: 'zz' }),
    ).rejects.toThrow();
  });
});
