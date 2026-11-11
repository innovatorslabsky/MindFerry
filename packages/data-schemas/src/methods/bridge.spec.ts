import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { BridgeRoleInput, BridgeRunInput } from '~/types/bridge';
import { createBridgeMethods, type BridgeMethods } from './bridge';
import bridgeRoleSchema from '~/schema/bridgeRole';
import bridgeRunSchema from '~/schema/bridgeRun';

let mongoServer: MongoMemoryServer;
let methods: BridgeMethods;

const userA = new mongoose.Types.ObjectId().toString();
const userB = new mongoose.Types.ObjectId().toString();
const DAY = '2026-11-11';

const roleInput = (over: Partial<BridgeRoleInput> = {}): BridgeRoleInput => ({
  slug: 'chief-of-staff',
  name: 'Chief of Staff',
  runtime: 'app',
  agentId: 'agent_abc',
  ...over,
});

let counter = 0;
const runInput = (roleId: string, over: Partial<BridgeRunInput> = {}): BridgeRunInput => {
  counter += 1;
  return {
    roleId,
    roleSlug: 'chief-of-staff',
    agentId: 'agent_abc',
    deliveryId: `delivery-${counter}`,
    conversationId: `convo-${counter}`,
    summary: 'Plan the week',
    counted: true,
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    day: DAY,
    ...over,
  };
};

async function makeRole(userId = userA, over: Partial<BridgeRoleInput> = {}): Promise<string> {
  const made = await methods.createBridgeRole(userId, roleInput(over), 50);
  if (!made.ok) {
    throw new Error(`role not created: ${made.code}`);
  }
  return made.role.id;
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  if (!mongoose.models.BridgeRole) {
    mongoose.model('BridgeRole', bridgeRoleSchema);
  }
  if (!mongoose.models.BridgeRun) {
    mongoose.model('BridgeRun', bridgeRunSchema);
  }
  await mongoose.connect(mongoServer.getUri());
  await mongoose.models.BridgeRole.syncIndexes();
  await mongoose.models.BridgeRun.syncIndexes();
  methods = createBridgeMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.models.BridgeRole.deleteMany({});
  await mongoose.models.BridgeRun.deleteMany({});
});

describe('roles', () => {
  it('creates a role with safe defaults and reads it back', async () => {
    const made = await methods.createBridgeRole(userA, roleInput(), 12);
    expect(made.ok).toBe(true);
    if (!made.ok) {
      return;
    }
    expect(made.role).toMatchObject({
      slug: 'chief-of-staff',
      name: 'Chief of Staff',
      runtime: 'app',
      agentId: 'agent_abc',
      brief: '',
      description: '',
      tier: 0,
      enabled: true,
      userId: userA,
    });
    expect(made.role.dailyCap).toBeUndefined();
    expect(await methods.getBridgeRole(userA, made.role.id)).toEqual(made.role);
  });

  it('refuses a second role with the same slug for the same person, but not for someone else', async () => {
    await makeRole();
    expect(await methods.createBridgeRole(userA, roleInput(), 50)).toEqual({
      ok: false,
      code: 'slug_taken',
    });
    expect((await methods.createBridgeRole(userB, roleInput(), 50)).ok).toBe(true);
  });

  it('stops at the role limit', async () => {
    await makeRole(userA, { slug: 'one' });
    await makeRole(userA, { slug: 'two' });
    expect(await methods.createBridgeRole(userA, roleInput({ slug: 'three' }), 2)).toEqual({
      ok: false,
      code: 'limit',
    });
  });

  it("lists a person's roles in the order they were made, and only theirs", async () => {
    await makeRole(userA, { slug: 'a', name: 'A' });
    await makeRole(userA, { slug: 'b', name: 'B' });
    await makeRole(userB, { slug: 'c', name: 'C' });
    expect((await methods.listBridgeRoles(userA)).map((role) => role.slug)).toEqual(['a', 'b']);
  });

  it("never returns or changes another person's role", async () => {
    const id = await makeRole(userA);
    expect(await methods.getBridgeRole(userB, id)).toBeNull();
    expect(await methods.updateBridgeRole(userB, id, { name: 'Hijacked' })).toBeNull();
    expect(await methods.deleteBridgeRole(userB, id)).toBe(false);
    expect((await methods.getBridgeRole(userA, id))?.name).toBe('Chief of Staff');
  });

  it('updates fields, sets and removes the daily cap', async () => {
    const id = await makeRole();
    const updated = await methods.updateBridgeRole(userA, id, {
      name: 'CoS',
      brief: 'Be brief.',
      enabled: false,
      dailyCap: 3,
    });
    expect(updated).toMatchObject({ name: 'CoS', brief: 'Be brief.', enabled: false, dailyCap: 3 });
    const cleared = await methods.updateBridgeRole(userA, id, { dailyCap: null });
    expect(cleared?.dailyCap).toBeUndefined();
    expect(cleared?.name).toBe('CoS');
  });

  it('rejects values the schema does not allow', async () => {
    const id = await makeRole();
    await expect(methods.updateBridgeRole(userA, id, { dailyCap: 0 })).rejects.toThrow();
    await expect(
      methods.updateBridgeRole(userA, id, { tier: 2 as unknown as 0 }),
    ).rejects.toThrow();
  });

  it('answers nothing, without throwing, for an id that is not an id', async () => {
    expect(await methods.getBridgeRole(userA, 'nope')).toBeNull();
    expect(await methods.updateBridgeRole(userA, '../x', { name: 'x' })).toBeNull();
    expect(await methods.deleteBridgeRole(userA, '')).toBe(false);
  });

  it('deletes a role', async () => {
    const id = await makeRole();
    expect(await methods.deleteBridgeRole(userA, id)).toBe(true);
    expect(await methods.getBridgeRole(userA, id)).toBeNull();
  });
});

describe('reserving a run', () => {
  it('records a run as queued and counted', async () => {
    const roleId = await makeRole();
    const result = await methods.reserveBridgeRun(userA, runInput(roleId), { role: 6, team: 25 });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.created).toBe(true);
    expect(result.run).toMatchObject({
      status: 'queued',
      counted: true,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      day: DAY,
      roleSlug: 'chief-of-staff',
    });
  });

  it('returns the same run when the same delivery is sent again, without counting twice', async () => {
    const roleId = await makeRole();
    const input = runInput(roleId);
    const first = await methods.reserveBridgeRun(userA, input, { role: 1 });
    const again = await methods.reserveBridgeRun(userA, input, { role: 1 });
    expect(again).toMatchObject({ ok: true, created: false });
    if (first.ok && again.ok) {
      expect(again.run.id).toBe(first.run.id);
    }
    expect((await methods.getBridgeUsage(userA, DAY)).team).toBe(1);
  });

  it('refuses a run over the role cap and leaves nothing behind', async () => {
    const roleId = await makeRole();
    for (let i = 0; i < 2; i += 1) {
      expect((await methods.reserveBridgeRun(userA, runInput(roleId), { role: 2 })).ok).toBe(true);
    }
    const third = await methods.reserveBridgeRun(userA, runInput(roleId), { role: 2 });
    expect(third).toEqual({ ok: false, code: 'cap_role', used: 2, cap: 2 });
    expect((await methods.getBridgeUsage(userA, DAY)).team).toBe(2);
    expect(await methods.listBridgeRuns(userA, { roleId })).toHaveLength(2);
  });

  it('refuses a run over the team cap even when the role is under its own', async () => {
    const one = await makeRole(userA, { slug: 'one' });
    const two = await makeRole(userA, { slug: 'two' });
    await methods.reserveBridgeRun(userA, runInput(one), { role: 6, team: 2 });
    await methods.reserveBridgeRun(userA, runInput(two), { role: 6, team: 2 });
    const over = await methods.reserveBridgeRun(userA, runInput(two), { role: 6, team: 2 });
    expect(over).toEqual({ ok: false, code: 'cap_team', used: 2, cap: 2 });
  });

  it('counts each day on its own, and each person on their own', async () => {
    const roleA = await makeRole(userA);
    const roleB = await makeRole(userB);
    await methods.reserveBridgeRun(userA, runInput(roleA), { role: 1, team: 1 });
    expect(
      (
        await methods.reserveBridgeRun(userA, runInput(roleA, { day: '2026-11-12' }), {
          role: 1,
          team: 1,
        })
      ).ok,
    ).toBe(true);
    expect((await methods.reserveBridgeRun(userB, runInput(roleB), { role: 1, team: 1 })).ok).toBe(
      true,
    );
  });

  it('does not count a run that never reaches a paid model, and does not cap it', async () => {
    const roleId = await makeRole();
    for (let i = 0; i < 4; i += 1) {
      const out = await methods.reserveBridgeRun(
        userA,
        runInput(roleId, { counted: false, provider: 'FreeLLMAPI' }),
        { role: 1, team: 1 },
      );
      expect(out.ok).toBe(true);
    }
    expect(await methods.getBridgeUsage(userA, DAY)).toEqual({ team: 0, byRole: {} });
  });

  it('never lets runs started at the same time go over the cap', async () => {
    const roleId = await makeRole();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        methods.reserveBridgeRun(userA, runInput(roleId), { role: 3, team: 25 }),
      ),
    );
    const accepted = results.filter((result) => result.ok).length;
    expect(accepted).toBeLessThanOrEqual(3);
    expect((await methods.getBridgeUsage(userA, DAY)).team).toBe(accepted);
    expect((await methods.getBridgeUsage(userA, DAY)).team).toBeLessThanOrEqual(3);
  });

  it('gives the slot back when a run is marked as never sent', async () => {
    const roleId = await makeRole();
    const made = await methods.reserveBridgeRun(userA, runInput(roleId), { role: 1 });
    expect((await methods.reserveBridgeRun(userA, runInput(roleId), { role: 1 })).ok).toBe(false);
    if (made.ok) {
      await methods.updateBridgeRun(userA, made.run.id, {
        status: 'failed',
        counted: false,
        error: 'enqueue_failed',
      });
    }
    expect((await methods.reserveBridgeRun(userA, runInput(roleId), { role: 1 })).ok).toBe(true);
  });
});

describe('reading runs', () => {
  it('updates status, lists newest first, limits the list and keeps persons apart', async () => {
    const roleId = await makeRole();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const out = await methods.reserveBridgeRun(userA, runInput(roleId), {});
      if (out.ok) {
        ids.push(out.run.id);
      }
    }
    const done = await methods.updateBridgeRun(userA, ids[0], {
      status: 'done',
      finishedAt: new Date('2026-11-11T05:00:00Z'),
    });
    expect(done).toMatchObject({ status: 'done' });
    expect(done?.finishedAt).toEqual(new Date('2026-11-11T05:00:00Z'));

    const list = await methods.listBridgeRuns(userA, { roleId });
    expect(list.map((run) => run.id)).toEqual([...ids].reverse());
    expect(await methods.listBridgeRuns(userA, { roleId, limit: 2 })).toHaveLength(2);
    expect(await methods.listBridgeRuns(userB, { roleId })).toEqual([]);
    expect(await methods.getBridgeRun(userB, ids[0])).toBeNull();
    expect(await methods.updateBridgeRun(userB, ids[0], { status: 'failed' })).toBeNull();
    expect(await methods.listBridgeRuns(userA, { roleId: 'bad' })).toEqual([]);
  });

  it("finds the latest run of each role and the day's usage by role", async () => {
    const one = await makeRole(userA, { slug: 'one' });
    const two = await makeRole(userA, { slug: 'two' });
    await methods.reserveBridgeRun(userA, runInput(one, { summary: 'first' }), {});
    const last = await methods.reserveBridgeRun(userA, runInput(one, { summary: 'second' }), {});
    await methods.reserveBridgeRun(userA, runInput(two), {});

    const latest = await methods.latestBridgeRuns(userA, [one, two, 'bad']);
    expect(Object.keys(latest).sort()).toEqual([one, two].sort());
    expect(latest[one].summary).toBe('second');
    if (last.ok) {
      expect(latest[one].id).toBe(last.run.id);
    }
    expect(await methods.getBridgeUsage(userA, DAY)).toEqual({
      team: 3,
      byRole: { [one]: 2, [two]: 1 },
    });
    expect(await methods.latestBridgeRuns(userA, [])).toEqual({});
  });
});
