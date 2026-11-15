import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { TBridgeAssignResponse, TBridgeRun } from 'librechat-data-provider';
import type { RolesActor, RolesResult } from '../roles/service';
import type { BridgeSettings } from '../config';
import type { ApprovalsDeps } from './service';
import { createApprovalsService, proposalHash } from './service';
import { getBridgeSettings } from '../config';

let mongo: MongoMemoryServer;
let methods: ReturnType<typeof createMethods>;

const user = new mongoose.Types.ObjectId().toString();
const other = new mongoose.Types.ObjectId().toString();
const actor: RolesActor = { id: user, role: 'ADMIN' };
const NOW = new Date('2026-11-14T10:00:00Z');

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { args: ['--nounixsocket'] } });
  await mongoose.connect(mongo.getUri());
  createModels(mongoose);
  methods = createMethods(mongoose);
  await Promise.all([
    mongoose.models.BridgeRole.init(),
    mongoose.models.BridgeProposal.init(),
    mongoose.models.BridgeAudit.init(),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await mongoose.models.BridgeRole.deleteMany({});
  await mongoose.models.BridgeProposal.deleteMany({});
  await mongoose.models.BridgeAudit.collection.deleteMany({});
});

async function makeRole(
  over: Partial<{ runtime: 'app' | 'hermes'; enabled: boolean; slug: string }> = {},
  owner = user,
): Promise<string> {
  const made = await methods.createBridgeRole(
    owner,
    {
      slug: over.slug ?? 'seo-petvee',
      name: 'SEO PetVee',
      runtime: over.runtime ?? 'hermes',
      ...((over.runtime ?? 'hermes') === 'hermes' ? { roleFile: 'seo-strategist-petvee' } : {}),
      ...((over.runtime ?? 'hermes') === 'app' ? { agentId: 'agent_x' } : {}),
      enabled: over.enabled ?? true,
    },
    50,
  );
  if (!made.ok) {
    throw new Error(`role not created: ${made.code}`);
  }
  return made.role.id;
}

type Calls = Array<{ roleId: string; requestId: string; task: string }>;

function setup(
  over: {
    settings?: Partial<BridgeSettings['approvals']>;
    fileRoles?: boolean;
    handOver?: ApprovalsDeps['handOver'];
    results?: Record<string, { status: string; text: string }>;
    now?: Date;
  } = {},
) {
  const calls: Calls = [];
  const base = getBridgeSettings({ agentBridge: { enabled: true, roles: {} } } as never);
  const settings: BridgeSettings = {
    ...base,
    roles: { ...base.roles, enabled: true, fileRolesEnabled: over.fileRoles ?? true },
    approvals: { ...base.approvals, enabled: true, ...over.settings },
  };
  let clock = over.now ?? NOW;
  const service = createApprovalsService({
    methods,
    getSettings: () => settings,
    handOver:
      over.handOver ??
      (async (_who, roleId, request) => {
        calls.push({ roleId, ...request });
        return okRun(roleId);
      }),
    readResult: async (taskId) => over.results?.[taskId] ?? null,
    now: () => clock,
  });
  return {
    service,
    calls,
    settings,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

const okRun = (roleId: string): RolesResult<TBridgeAssignResponse> => ({
  ok: true,
  value: {
    replayed: false,
    run: {
      id: new mongoose.Types.ObjectId().toString(),
      roleId,
      roleSlug: 'seo-petvee',
      runtime: 'hermes',
      summary: 'x',
      status: 'queued',
      counted: true,
      createdAt: NOW.toISOString(),
    } satisfies TBridgeRun,
  },
});

const REQ = (n: number | string) => `request-${n}-abcdef`;

async function propose(
  service: ReturnType<typeof setup>['service'],
  roleId: string,
  task = 'Draft the Google Play description',
  requestId = REQ(Math.random()),
) {
  const result = await service.create(actor, { requestId, roleId, task });
  if (!result.ok) {
    throw new Error(`not created: ${result.error.code}`);
  }
  return result.value;
}

const actions = async (proposalId?: string): Promise<string[]> =>
  (await methods.listBridgeAudit(user, { ...(proposalId ? { proposalId } : {}), limit: 100 }))
    .map((line) => line.action)
    .reverse();

describe('create', () => {
  it('stores a pending proposal with the hash of the role and text, and one ledger line', async () => {
    const { service, settings } = setup();
    const roleId = await makeRole();
    const proposal = await propose(service, roleId, '  Draft the listing  ');
    expect(proposal.status).toBe('pending');
    expect(proposal.content).toBe('Draft the listing');
    expect(proposal.hash).toBe(proposalHash(roleId, 'Draft the listing'));
    expect(proposal.roleSlug).toBe('seo-petvee');
    expect(proposal.source).toBe('person');
    expect(new Date(proposal.expiresAt).getTime()).toBe(
      NOW.getTime() + settings.approvals.expiryHours * 3_600_000,
    );
    expect(await actions(proposal.id)).toEqual(['proposal_created']);
  });

  it('adds nothing for a repeated request id and writes no second ledger line', async () => {
    const { service } = setup();
    const roleId = await makeRole();
    const first = await propose(service, roleId, 'one', REQ('same'));
    const again = await propose(service, roleId, 'a different text', REQ('same'));
    expect(again.id).toBe(first.id);
    expect(again.content).toBe('one');
    expect((await service.overview(user)).proposals).toHaveLength(1);
    expect(await actions()).toEqual(['proposal_created']);
  });

  it.each([
    ['an empty task', { task: '   ' }, 'task'],
    ['a task that is too long', { task: 'x'.repeat(5000) }, 'task'],
    ['a short request id', { requestId: 'short' }, 'requestId'],
  ])('refuses %s', async (_name, patch, field) => {
    const { service } = setup();
    const roleId = await makeRole();
    const result = await service.create(actor, { requestId: REQ(1), roleId, task: 'ok', ...patch });
    expect(result).toEqual({ ok: false, error: { code: 'APPROVAL_INVALID', field } });
  });

  it('refuses a task that carries a secret, and stores nothing', async () => {
    const { service } = setup();
    const roleId = await makeRole();
    const result = await service.create(actor, {
      requestId: REQ(2),
      roleId,
      task: 'use key sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE00',
    });
    expect(result).toEqual({
      ok: false,
      error: { code: 'APPROVAL_SECRET_DETECTED', field: 'task' },
    });
    expect((await service.overview(user)).proposals).toEqual([]);
  });

  it('refuses a role that is missing, disabled, someone else’s, or a locked file role', async () => {
    const { service } = setup({ fileRoles: false });
    const disabled = await makeRole({ enabled: false, slug: 'off' });
    const file = await makeRole({ slug: 'file' });
    const theirs = await makeRole({ slug: 'theirs' }, other);
    for (const roleId of [new mongoose.Types.ObjectId().toString(), disabled, file, theirs]) {
      const result = await service.create(actor, { requestId: REQ(roleId), roleId, task: 'ok' });
      expect(result).toEqual({ ok: false, error: { code: 'APPROVAL_ROLE_UNAVAILABLE' } });
    }
  });

  it('refuses over the pending limit', async () => {
    const { service } = setup({ settings: { maxPending: 2 } });
    const roleId = await makeRole();
    await propose(service, roleId);
    await propose(service, roleId);
    const over = await service.create(actor, { requestId: REQ('over'), roleId, task: 'ok' });
    expect(over).toEqual({ ok: false, error: { code: 'APPROVAL_LIMIT', cap: 2 } });
    expect(await actions()).toEqual(['proposal_created', 'proposal_created']);
  });
});

describe('approve', () => {
  it('writes the ledger line first, hands over the exact text once, and links the run', async () => {
    const { service, calls } = setup();
    const roleId = await makeRole();
    const proposal = await propose(service, roleId, 'Draft the listing');
    const result = await service.decide(actor, proposal.id, {
      decision: 'approve',
      hash: proposal.hash,
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      { roleId, requestId: `approval:${proposal.id}`, task: 'Draft the listing' },
    ]);
    if (result.ok) {
      expect(result.value.proposal.status).toBe('approved');
      expect(result.value.run?.id).toBeTruthy();
      expect(result.value.proposal.runId).toBe(result.value.run?.id);
    }
    expect(await actions(proposal.id)).toEqual([
      'proposal_created',
      'proposal_approved',
      'handed_over',
    ]);
    const lines = await methods.listBridgeAudit(user, { proposalId: proposal.id });
    expect(lines.find((line) => line.action === 'proposal_approved')?.actor).toBe(`user:${user}`);
    expect(lines.every((line) => line.hash === proposal.hash)).toBe(true);
  });

  it('has the approval in the ledger before the hand-over starts', async () => {
    let seen: string[] = [];
    const { service } = setup({
      handOver: async (_who, roleId) => {
        seen = (await methods.listBridgeAudit(user, { limit: 100 })).map((line) => line.action);
        return okRun(roleId);
      },
    });
    const roleId = await makeRole();
    const proposal = await propose(service, roleId);
    await service.decide(actor, proposal.id, { decision: 'approve', hash: proposal.hash });
    expect(seen).toContain('proposal_approved');
    expect(seen).not.toContain('handed_over');
  });

  it('needs the hash that was shown: missing, malformed or different is refused and nothing runs', async () => {
    const { service, calls } = setup();
    const roleId = await makeRole();
    const proposal = await propose(service, roleId);
    expect(await service.decide(actor, proposal.id, { decision: 'approve' })).toEqual({
      ok: false,
      error: { code: 'APPROVAL_INVALID', field: 'hash' },
    });
    expect(await service.decide(actor, proposal.id, { decision: 'approve', hash: 'zz' })).toEqual({
      ok: false,
      error: { code: 'APPROVAL_INVALID', field: 'hash' },
    });
    expect(
      await service.decide(actor, proposal.id, { decision: 'approve', hash: 'b'.repeat(64) }),
    ).toEqual({ ok: false, error: { code: 'APPROVAL_HASH_MISMATCH' } });
    expect(calls).toEqual([]);
    expect((await service.overview(user)).proposals[0].status).toBe('pending');
  });

  it('refuses to hand over text that no longer matches its hash', async () => {
    const { service, calls } = setup();
    const roleId = await makeRole();
    const proposal = await propose(service, roleId, 'Draft the listing');
    await mongoose.models.BridgeProposal.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(proposal.id) },
      { $set: { content: 'Delete everything' } },
    );
    const result = await service.decide(actor, proposal.id, {
      decision: 'approve',
      hash: proposal.hash,
    });
    expect(result).toEqual({ ok: false, error: { code: 'APPROVAL_HASH_MISMATCH' } });
    expect(calls).toEqual([]);
    expect((await service.overview(user)).proposals[0].status).toBe('pending');
  });

  it('keeps the proposal approved when the hand-over fails, records why, and a retry finishes it', async () => {
    let attempt = 0;
    const { service } = setup({
      handOver: async (_who, roleId) => {
        attempt += 1;
        return attempt === 1
          ? { ok: false, error: { code: 'CAP_TEAM', used: 25, cap: 25 } }
          : okRun(roleId);
      },
    });
    const roleId = await makeRole();
    const proposal = await propose(service, roleId);
    const first = await service.decide(actor, proposal.id, {
      decision: 'approve',
      hash: proposal.hash,
    });
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.error.code).toBe('APPROVAL_HANDOVER_FAILED');
      expect(first.error.cause).toBe('CAP_TEAM');
      expect(first.error.proposal?.status).toBe('approved');
    }
    expect(await actions(proposal.id)).toEqual([
      'proposal_created',
      'proposal_approved',
      'handover_failed',
    ]);
    const failed = (await methods.listBridgeAudit(user, { proposalId: proposal.id })).find(
      (line) => line.action === 'handover_failed',
    );
    expect(failed?.detail).toBe('CAP_TEAM');

    const retry = await service.decide(actor, proposal.id, {
      decision: 'approve',
      hash: proposal.hash,
    });
    expect(retry.ok && retry.value.run?.id).toBeTruthy();
    expect(await actions(proposal.id)).toEqual([
      'proposal_created',
      'proposal_approved',
      'handover_failed',
      'handed_over',
    ]);
  });

  it('does not hand over again once a run is linked', async () => {
    const { service, calls } = setup();
    const roleId = await makeRole();
    const proposal = await propose(service, roleId);
    await service.decide(actor, proposal.id, { decision: 'approve', hash: proposal.hash });
    const again = await service.decide(actor, proposal.id, {
      decision: 'approve',
      hash: proposal.hash,
    });
    expect(again.ok && again.value.run).toBeUndefined();
    expect(again.ok && again.value.proposal.runId).toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  it('will not approve a denied or another person’s proposal, or an unknown one', async () => {
    const { service, calls } = setup();
    const roleId = await makeRole();
    const proposal = await propose(service, roleId);
    await service.decide(actor, proposal.id, { decision: 'deny' });
    expect(
      await service.decide(actor, proposal.id, { decision: 'approve', hash: proposal.hash }),
    ).toEqual({
      ok: false,
      error: { code: 'APPROVAL_NOT_PENDING' },
    });
    const mine = await propose(service, roleId);
    expect(
      await service.decide({ id: other }, mine.id, { decision: 'approve', hash: mine.hash }),
    ).toEqual({ ok: false, error: { code: 'APPROVAL_NOT_FOUND' } });
    expect(
      await service.decide(actor, new mongoose.Types.ObjectId().toString(), {
        decision: 'approve',
        hash: mine.hash,
      }),
    ).toEqual({ ok: false, error: { code: 'APPROVAL_NOT_FOUND' } });
    expect(calls).toEqual([]);
  });

  it('will not approve after the time is up, and the ledger records the expiry once', async () => {
    const { service, calls, advance, settings } = setup();
    const roleId = await makeRole();
    const proposal = await propose(service, roleId);
    advance((settings.approvals.expiryHours + 1) * 3_600_000);
    const result = await service.decide(actor, proposal.id, {
      decision: 'approve',
      hash: proposal.hash,
    });
    expect(result).toEqual({ ok: false, error: { code: 'APPROVAL_EXPIRED' } });
    await service.overview(user);
    expect(await actions(proposal.id)).toEqual(['proposal_created', 'proposal_expired']);
    expect(calls).toEqual([]);
  });
});

describe('deny and overview', () => {
  it('denies without a hand-over, once in the ledger even if repeated', async () => {
    const { service, calls } = setup();
    const roleId = await makeRole();
    const proposal = await propose(service, roleId);
    const first = await service.decide(actor, proposal.id, { decision: 'deny' });
    const second = await service.decide(actor, proposal.id, { decision: 'deny' });
    expect(first.ok && first.value.proposal.status).toBe('denied');
    expect(second.ok).toBe(true);
    expect(calls).toEqual([]);
    expect(await actions(proposal.id)).toEqual(['proposal_created', 'proposal_denied']);
  });

  it('expires the ones past their time when the list is read, and counts what is waiting', async () => {
    const { service, advance, settings } = setup();
    const roleId = await makeRole();
    await propose(service, roleId);
    advance((settings.approvals.expiryHours + 1) * 3_600_000);
    await propose(service, roleId);
    const overview = await service.overview(user);
    expect(overview.pending).toBe(1);
    expect(overview.proposals.map((p) => p.status).sort()).toEqual(['expired', 'pending']);
    expect(overview.maxPending).toBe(settings.approvals.maxPending);
    expect(overview.expiryHours).toBe(settings.approvals.expiryHours);
    expect((await service.overview(other)).proposals).toEqual([]);
  });

  it('lists the ledger for one proposal or for the person, newest first', async () => {
    const { service } = setup();
    const roleId = await makeRole();
    const a = await propose(service, roleId);
    const b = await propose(service, roleId);
    await service.decide(actor, a.id, { decision: 'deny' });
    expect((await service.audit(user, a.id)).map((line) => line.action)).toEqual([
      'proposal_denied',
      'proposal_created',
    ]);
    expect(await service.audit(user)).toHaveLength(3);
    expect((await service.audit(user, b.id))[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await service.audit(other)).toEqual([]);
  });
});

describe('importing follow-ups from a result', () => {
  const TASK = '2026-11-14-0921-hermes-seo-strategist-petvee';
  const result = (lines: string[], status = 'DONE') => ({
    status,
    text: `status: ${status}\n\n1. Summary\nok\n\n## Proposed follow-ups\n${lines.join('\n')}\n`,
  });

  it('turns each valid item into a pending proposal that remembers where it came from', async () => {
    const { service } = setup({
      results: {
        [TASK]: result([
          '- role: seo-petvee | task: Draft the Google Play short description.',
          '- role: seo-petvee | task: List five keyword ideas.',
        ]),
      },
    });
    const roleId = await makeRole();
    const done = await service.importFromResult(actor, TASK);
    expect(done.ok).toBe(true);
    if (done.ok) {
      expect(done.value.added).toBe(2);
      expect(done.value.skipped).toEqual([]);
      expect(done.value.proposals.map((p) => p.content)).toEqual([
        'Draft the Google Play short description.',
        'List five keyword ideas.',
      ]);
      expect(
        done.value.proposals.every((p) => p.source === 'result' && p.status === 'pending'),
      ).toBe(true);
      expect(
        done.value.proposals.every((p) => p.originTaskId === TASK && p.roleId === roleId),
      ).toBe(true);
    }
    const lines = await methods.listBridgeAudit(user, { limit: 10 });
    expect(lines.map((line) => line.detail)).toEqual(['from_result', 'from_result']);
  });

  it('adds nothing the second time, and a changed result cannot change a proposal already made', async () => {
    const results: Record<string, { status: string; text: string }> = {
      [TASK]: result(['- role: seo-petvee | task: Original text.']),
    };
    const { service } = setup({ results });
    await makeRole();
    const first = await service.importFromResult(actor, TASK);
    results[TASK] = result(['- role: seo-petvee | task: Rewritten after the fact.']);
    const again = await service.importFromResult(actor, TASK);
    expect(first.ok && first.value.added).toBe(1);
    expect(again.ok && again.value.added).toBe(0);
    expect(again.ok && again.value.proposals[0].content).toBe('Original text.');
    expect((await service.overview(user)).proposals).toHaveLength(1);
    expect(await actions()).toEqual(['proposal_created']);
  });

  it('skips an item with a reason and still imports the others', async () => {
    const { service } = setup({
      fileRoles: false,
      results: {
        [TASK]: result([
          '- role: nobody | task: Unknown role.',
          '- role: off | task: Disabled role.',
          '- role: file-role | task: A host role while they are locked.',
          '- role: app-role | task: Fine.',
          `- role: app-role | task: ${'x'.repeat(2100)}`,
        ]),
      },
    });
    await makeRole({ runtime: 'app', slug: 'app-role' });
    await makeRole({ enabled: false, runtime: 'app', slug: 'off' });
    await makeRole({ runtime: 'hermes', slug: 'file-role' });
    const done = await service.importFromResult(actor, TASK);
    expect(done.ok && done.value.skipped).toEqual([
      { index: 0, role: 'nobody', reason: 'role_unknown' },
      { index: 1, role: 'off', reason: 'role_unavailable' },
      { index: 2, role: 'file-role', reason: 'role_unavailable' },
      { index: 4, role: 'app-role', reason: 'too_long' },
    ]);
    expect(done.ok && done.value.added).toBe(1);
    expect(done.ok && done.value.proposals[0].content).toBe('Fine.');
  });

  it('skips a task that carries a secret', async () => {
    const { service } = setup({
      results: {
        [TASK]: result([
          '- role: seo-petvee | task: use key sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE00',
        ]),
      },
    });
    await makeRole();
    const done = await service.importFromResult(actor, TASK);
    expect(done.ok && done.value.skipped).toEqual([
      { index: 0, role: 'seo-petvee', reason: 'secret' },
    ]);
    expect(done.ok && done.value.added).toBe(0);
  });

  it('skips a task with a hidden character', async () => {
    const { service } = setup({
      results: { [TASK]: result(['- role: seo-petvee | task: Draft\u202Eit.']) },
    });
    await makeRole();
    const done = await service.importFromResult(actor, TASK);
    expect(done.ok && done.value.skipped).toEqual([
      { index: 0, role: 'seo-petvee', reason: 'hidden' },
    ]);
    expect(done.ok && done.value.added).toBe(0);
  });

  it('stops at the pending limit and says which items it left', async () => {
    const { service } = setup({
      settings: { maxPending: 2 },
      results: {
        [TASK]: result([1, 2, 3, 4].map((n) => `- role: seo-petvee | task: Task ${n}.`)),
      },
    });
    await makeRole();
    const done = await service.importFromResult(actor, TASK);
    expect(done.ok && done.value.added).toBe(2);
    expect(done.ok && done.value.skipped.map((s) => [s.index, s.reason])).toEqual([
      [2, 'limit'],
      [3, 'limit'],
    ]);
  });

  it('counts what it ignored: lines that are not items and items past five', async () => {
    const { service } = setup({
      results: {
        [TASK]: result([
          'chatter',
          ...Array.from({ length: 7 }, (_, n) => `- role: seo-petvee | task: Task ${n}.`),
        ]),
      },
    });
    await makeRole();
    const done = await service.importFromResult(actor, TASK);
    expect(done.ok && done.value.added).toBe(5);
    expect(done.ok && done.value.ignored).toBe(3);
  });

  it('refuses a result that is missing or not finished, and a result with no section is empty', async () => {
    const { service } = setup({
      results: {
        failed: result(['- role: seo-petvee | task: x.'], 'FAILED'),
        plain: { status: 'DONE', text: 'status: DONE\n\nno section here' },
      },
    });
    await makeRole();
    expect(await service.importFromResult(actor, 'missing')).toEqual({
      ok: false,
      error: { code: 'APPROVAL_NOT_FOUND' },
    });
    expect(await service.importFromResult(actor, 'failed')).toEqual({
      ok: false,
      error: { code: 'APPROVAL_INVALID', field: 'status' },
    });
    const plain = await service.importFromResult(actor, 'plain');
    expect(plain.ok && plain.value).toEqual({ proposals: [], added: 0, skipped: [], ignored: 0 });
  });

  it('only matches roles the person owns', async () => {
    const { service } = setup({
      results: { [TASK]: result(['- role: seo-petvee | task: x.']) },
    });
    await makeRole({}, other);
    const done = await service.importFromResult(actor, TASK);
    expect(done.ok && done.value.skipped[0].reason).toBe('role_unknown');
  });

  it('hands over the exact snapshot when it is approved', async () => {
    const { service, calls } = setup({
      results: { [TASK]: result(['- role: seo-petvee | task: Draft the store listing.']) },
    });
    const roleId = await makeRole();
    const done = await service.importFromResult(actor, TASK);
    const proposal = done.ok ? done.value.proposals[0] : undefined;
    expect(proposal).toBeDefined();
    await service.decide(actor, proposal?.id ?? '', { decision: 'approve', hash: proposal?.hash });
    expect(calls).toEqual([
      { roleId, requestId: `approval:${proposal?.id}`, task: 'Draft the store listing.' },
    ]);
  });
});
