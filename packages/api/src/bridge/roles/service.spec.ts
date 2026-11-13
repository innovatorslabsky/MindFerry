import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { promises as fs } from 'fs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { AgentTriggerEnvelope } from '../../agents/triggers/envelope';
import type { RolesActor, RolesDeps, JobStatus } from './service';
import type { BridgeSettings } from '../config';
import { AgentTriggerServiceUnavailableError } from '../../agents/triggers/service';
import type { BridgeStore } from '../store';
import { createBridgeStore } from '../store';
import { createRolesService } from './service';
import { getBridgeSettings } from '../config';

let mongo: MongoMemoryServer;
let methods: ReturnType<typeof createMethods>;

const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
const user = new mongoose.Types.ObjectId().toString();
const other = new mongoose.Types.ObjectId().toString();
const actor: RolesActor = { id: user, role: 'ADMIN' };

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { args: ['--nounixsocket'] } });
  await mongoose.connect(mongo.getUri());
  createModels(mongoose);
  methods = createMethods(mongoose);
  await Promise.all([mongoose.models.BridgeRole.init(), mongoose.models.BridgeRun.init()]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await mongoose.models.BridgeRole.deleteMany({});
  await mongoose.models.BridgeRun.deleteMany({});
});

type Overrides = {
  settings?: Partial<BridgeSettings['roles']>;
  provider?: string;
  enqueue?: RolesDeps['enqueueTrigger'];
  job?: JobStatus | null;
  agents?: Record<string, boolean>;
  now?: Date;
  store?: BridgeStore;
  tasksDir?: string;
};

function setup(over: Overrides = {}) {
  const sent: AgentTriggerEnvelope[] = [];
  let counter = 0;
  const base = getBridgeSettings({
    agentBridge: {
      enabled: true,
      ...(over.tasksDir ? { tasksDir: over.tasksDir } : {}),
      roles: {},
    },
  } as never);
  const settings: BridgeSettings = {
    ...base,
    roles: { ...base.roles, enabled: true, ...over.settings },
  };
  let job: JobStatus | null = over.job ?? null;
  let clock = over.now ?? NOW;
  const service = createRolesService({
    methods,
    getSettings: () => settings,
    resolveAgent: async (_actor, agentId) =>
      over.agents?.[agentId] === false
        ? null
        : { id: agentId, provider: over.provider ?? 'anthropic', model: 'claude-sonnet-4-6' },
    enqueueTrigger:
      over.enqueue ??
      (async (envelope) => {
        sent.push(envelope);
      }),
    getJobStatus: async () => job,
    ...(over.store
      ? {
          fileTasks: {
            create: (input, at) => over.store!.create(input, at),
            state: (id) => over.store!.taskState(id),
          },
        }
      : {}),
    now: () => clock,
    newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
  });
  return {
    service,
    sent,
    setJob: (next: JobStatus | null) => {
      job = next;
    },
    setNow: (next: Date) => {
      clock = next;
    },
  };
}

const makeRole = async (service: ReturnType<typeof setup>['service'], name = 'Researcher') => {
  const created = await service.createRole(actor, { name, agentId: 'agent_one' });
  if (!created.ok) {
    throw new Error(`could not create role: ${created.error.code}`);
  }
  return created.value;
};

describe('creating and changing roles', () => {
  it('creates an app role, names it from the title and takes tier 0 by default', async () => {
    const { service } = setup();
    const role = await makeRole(service, 'Chief of Staff!');
    expect(role).toMatchObject({
      slug: 'chief-of-staff',
      runtime: 'app',
      tier: 0,
      enabled: true,
      agentId: 'agent_one',
    });
  });

  it('fills brief, description and tier from a template, and lets the person override', async () => {
    const { service } = setup();
    const made = await service.createRole(actor, {
      name: 'Weekly',
      agentId: 'agent_one',
      templateId: 'chief-of-staff',
      description: 'mine',
    });
    expect(made.ok && made.value.brief).toContain('no access to personal notes');
    expect(made.ok && made.value.description).toBe('mine');
    expect(made.ok && made.value.templateId).toBe('chief-of-staff');
  });

  it('gives a second role of the same name its own slug', async () => {
    const { service } = setup();
    await makeRole(service);
    const second = await makeRole(service);
    expect(second.slug).toBe('researcher-2');
  });

  it.each([
    ['an empty name', { name: '  ', agentId: 'agent_one' }, 'ROLE_INVALID'],
    ['a tier above 1', { name: 'X', agentId: 'agent_one', tier: 2 as never }, 'ROLE_INVALID'],
    [
      'an unknown template',
      { name: 'X', agentId: 'agent_one', templateId: 'nope' },
      'ROLE_INVALID',
    ],
    ['a non-app runtime', { name: 'X', runtime: 'hermes' as const }, 'ROLE_LOCKED'],
    ['no agent', { name: 'X' }, 'ROLE_AGENT_UNAVAILABLE'],
    [
      'a key in the brief',
      { name: 'X', agentId: 'agent_one', brief: 'use sk-ant-api03-abcdefghijklmnopqrstuvwx' },
      'ROLE_SECRET_DETECTED',
    ],
  ])('refuses %s', async (_label, input, code) => {
    const { service } = setup();
    const result = await service.createRole(actor, input);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe(code);
  });

  it('refuses a brief over the limit and an agent the person cannot run', async () => {
    const { service } = setup({ settings: { maxBriefChars: 100 }, agents: { agent_no: false } });
    const long = await service.createRole(actor, {
      name: 'X',
      agentId: 'agent_one',
      brief: 'a'.repeat(101),
    });
    expect(!long.ok && long.error).toEqual({ code: 'ROLE_INVALID', field: 'brief' });
    const blocked = await service.createRole(actor, { name: 'X', agentId: 'agent_no' });
    expect(!blocked.ok && blocked.error.code).toBe('ROLE_AGENT_UNAVAILABLE');
  });

  it('stops at the role limit', async () => {
    const { service } = setup({ settings: { maxRoles: 1 } });
    await makeRole(service);
    const result = await service.createRole(actor, { name: 'Other', agentId: 'agent_one' });
    expect(!result.ok && result.error).toEqual({ code: 'ROLE_LIMIT', cap: 1 });
  });

  it('updates, switches off and removes only the owner’s role', async () => {
    const { service } = setup();
    const role = await makeRole(service);
    const updated = await service.updateRole(actor, role.id, {
      name: 'Analyst',
      enabled: false,
      dailyCap: 2,
    });
    expect(updated.ok && updated.value).toMatchObject({
      name: 'Analyst',
      enabled: false,
      dailyCap: 2,
    });
    const cleared = await service.updateRole(actor, role.id, { dailyCap: null });
    expect(cleared.ok && cleared.value.dailyCap).toBeUndefined();

    const stranger = await service.updateRole({ id: other }, role.id, { name: 'Mine now' });
    expect(!stranger.ok && stranger.error.code).toBe('ROLE_NOT_FOUND');
    expect((await service.deleteRole(other, role.id)).ok).toBe(false);
    expect((await service.deleteRole(user, role.id)).ok).toBe(true);
    expect((await service.overview(user)).roles).toHaveLength(0);
  });
});

describe('handing a task to a role', () => {
  it('sends one fire envelope with the role brief and a pre-made conversation', async () => {
    const { service, sent } = setup();
    const role = await makeRole(service);
    const result = await service.assign(actor, role.id, {
      requestId: 'req-00000001',
      task: 'Compare two vendors',
    });
    expect(result.ok && result.value.replayed).toBe(false);
    expect(sent).toHaveLength(1);
    const envelope = sent[0];
    expect(envelope).toMatchObject({
      mode: 'fire',
      target: { agentId: 'agent_one' },
      principal: { userId: user, role: 'ADMIN' },
      event: { type: 'bridge.assignment', source: { id: role.id, type: 'bridge-role' } },
      deliveryId: 'bridge:req-00000001',
    });
    expect(envelope.input).toContain('Role: Researcher');
    expect(envelope.input).toContain('read and draft only');
    expect(envelope.input).toContain('Task:\nCompare two vendors');
    const convo = envelope.mode === 'fire' ? envelope.run?.conversationId : undefined;
    expect(result.ok && result.value.run.conversationId).toBe(convo);
  });

  it('does not start a second run for the same request id', async () => {
    const { service, sent } = setup();
    const role = await makeRole(service);
    const first = await service.assign(actor, role.id, {
      requestId: 'req-00000001',
      task: 'Do it',
    });
    const again = await service.assign(actor, role.id, {
      requestId: 'req-00000001',
      task: 'Do it',
    });
    expect(again.ok && again.value.replayed).toBe(true);
    expect(again.ok && first.ok && again.value.run.id).toBe(first.ok && first.value.run.id);
    expect(sent).toHaveLength(1);
  });

  it('counts a run only when the agent uses the paid provider', async () => {
    const paid = setup();
    const role = await makeRole(paid.service);
    const run = await paid.service.assign(actor, role.id, { requestId: 'req-paid-001', task: 'x' });
    expect(run.ok && run.value.run.counted).toBe(true);
    expect((await paid.service.overview(user)).usage.team.used).toBe(1);

    const free = setup({ provider: 'FreeLLMAPI' });
    const free1 = await free.service.assign(actor, role.id, {
      requestId: 'req-free-001',
      task: 'y',
    });
    expect(free1.ok && free1.value.run.counted).toBe(false);
    expect((await free.service.overview(user)).usage.team.used).toBe(1);
  });

  it('stops at the role cap and at the team cap, without sending', async () => {
    const { service, sent } = setup({ settings: { dailyCapPerRole: 2, dailyCapTeam: 3 } });
    const a = await makeRole(service, 'Alpha');
    const b = await makeRole(service, 'Beta');
    await service.assign(actor, a.id, { requestId: 'req-a-000001', task: '1' });
    await service.assign(actor, a.id, { requestId: 'req-a-000002', task: '2' });
    const capped = await service.assign(actor, a.id, { requestId: 'req-a-000003', task: '3' });
    expect(!capped.ok && capped.error).toEqual({ code: 'CAP_ROLE', used: 2, cap: 2 });

    await service.assign(actor, b.id, { requestId: 'req-b-000001', task: '4' });
    const team = await service.assign(actor, b.id, { requestId: 'req-b-000002', task: '5' });
    expect(!team.ok && team.error.code).toBe('CAP_TEAM');
    expect(sent).toHaveLength(3);
  });

  it('uses the role’s own cap in place of the default', async () => {
    const { service } = setup({ settings: { dailyCapPerRole: 5 } });
    const role = await makeRole(service);
    await service.updateRole(actor, role.id, { dailyCap: 1 });
    await service.assign(actor, role.id, { requestId: 'req-00000001', task: 'one' });
    const second = await service.assign(actor, role.id, { requestId: 'req-00000002', task: 'two' });
    expect(!second.ok && second.error).toMatchObject({ code: 'CAP_ROLE', cap: 1 });
  });

  it('counts a new day afresh', async () => {
    const { service, setNow } = setup({ settings: { dailyCapPerRole: 1 } });
    const role = await makeRole(service);
    await service.assign(actor, role.id, { requestId: 'req-00000001', task: 'today' });
    setNow(new Date(NOW.getTime() + 24 * 60 * 60_000));
    const next = await service.assign(actor, role.id, {
      requestId: 'req-00000002',
      task: 'tomorrow',
    });
    expect(next.ok).toBe(true);
  });

  it('gives the slot back when the queue definitely refused the task', async () => {
    const refuse = async () => {
      throw new AgentTriggerServiceUnavailableError('down');
    };
    const { service } = setup({ enqueue: refuse, settings: { dailyCapPerRole: 1 } });
    const role = await makeRole(service);
    const result = await service.assign(actor, role.id, { requestId: 'req-00000001', task: 'x' });
    expect(!result.ok && result.error.code).toBe('ASSIGN_FAILED');
    const view = await service.overview(user);
    expect(view.usage.team.used).toBe(0);
    expect(view.runs[0]).toMatchObject({
      status: 'failed',
      error: 'enqueue_failed',
      counted: false,
    });
  });

  it('keeps the slot when the outcome of the queue call is unknown', async () => {
    const unsure = async () => {
      throw new Error('socket hang up');
    };
    const { service } = setup({ enqueue: unsure });
    const role = await makeRole(service);
    const result = await service.assign(actor, role.id, { requestId: 'req-00000001', task: 'x' });
    expect(!result.ok && result.error.code).toBe('ASSIGN_FAILED');
    const view = await service.overview(user);
    expect(view.usage.team.used).toBe(1);
    expect(view.runs[0].error).toBe('enqueue_unconfirmed');
  });

  it('limits how many tasks a person can hand over in an hour, but never blocks a replay', async () => {
    const { service } = setup({
      settings: { assignPerHour: 2, dailyCapPerRole: 50, dailyCapTeam: 50 },
    });
    const role = await makeRole(service);
    await service.assign(actor, role.id, { requestId: 'req-00000001', task: '1' });
    await service.assign(actor, role.id, { requestId: 'req-00000002', task: '2' });
    const third = await service.assign(actor, role.id, { requestId: 'req-00000003', task: '3' });
    expect(!third.ok && third.error.code).toBe('ASSIGN_RATE_LIMITED');
    const replay = await service.assign(actor, role.id, { requestId: 'req-00000002', task: '2' });
    expect(replay.ok && replay.value.replayed).toBe(true);
  });

  it.each([
    ['an empty task', { requestId: 'req-00000001', task: '   ' }, 'ROLE_INVALID'],
    ['an over-long task', { requestId: 'req-00000001', task: 'a'.repeat(2001) }, 'ROLE_INVALID'],
    ['a short request id', { requestId: 'x', task: 'ok' }, 'ROLE_INVALID'],
    [
      'a key in the task',
      { requestId: 'req-00000001', task: 'token sk-ant-api03-abcdefghijklmnopqrstuvwx' },
      'ROLE_SECRET_DETECTED',
    ],
  ])('refuses %s', async (_label, request, code) => {
    const { service, sent } = setup();
    const role = await makeRole(service);
    const result = await service.assign(actor, role.id, request);
    expect(!result.ok && result.error.code).toBe(code);
    expect(sent).toHaveLength(0);
  });

  it('refuses a switched-off role, a missing role, another person’s role and a lost agent', async () => {
    const lost = setup({ agents: { agent_one: true } });
    const role = await makeRole(lost.service);
    await lost.service.updateRole(actor, role.id, { enabled: false });
    const off = await lost.service.assign(actor, role.id, { requestId: 'req-00000001', task: 'x' });
    expect(!off.ok && off.error.code).toBe('ROLE_DISABLED');
    await lost.service.updateRole(actor, role.id, { enabled: true });

    const missing = await lost.service.assign(actor, new mongoose.Types.ObjectId().toString(), {
      requestId: 'req-00000002',
      task: 'x',
    });
    expect(!missing.ok && missing.error.code).toBe('ROLE_NOT_FOUND');
    const theirs = await lost.service.assign({ id: other }, role.id, {
      requestId: 'req-00000003',
      task: 'x',
    });
    expect(!theirs.ok && theirs.error.code).toBe('ROLE_NOT_FOUND');

    const gone = setup({ agents: { agent_one: false } });
    const noAgent = await gone.service.assign(actor, role.id, {
      requestId: 'req-00000004',
      task: 'x',
    });
    expect(!noAgent.ok && noAgent.error.code).toBe('ROLE_AGENT_UNAVAILABLE');
    expect(gone.sent).toHaveLength(0);
  });

  it('keeps a role that runs on the host agents locked', async () => {
    const { service, sent } = setup();
    const role = await makeRole(service);
    await mongoose.models.BridgeRole.updateOne({ _id: role.id }, { runtime: 'hermes' });
    const result = await service.assign(actor, role.id, { requestId: 'req-00000001', task: 'x' });
    expect(!result.ok && result.error.code).toBe('ROLE_LOCKED');
    expect(sent).toHaveLength(0);
  });
});

describe('the overview', () => {
  it('lists roles, templates, usage against caps and the limits', async () => {
    const { service } = setup({ settings: { dailyCapPerRole: 4, dailyCapTeam: 9 } });
    const role = await makeRole(service);
    await service.assign(actor, role.id, { requestId: 'req-00000001', task: 'a' });
    const view = await service.overview(user);
    expect(view.roles.map((r) => r.id)).toEqual([role.id]);
    expect(view.templates.map((t) => t.id)).toContain('chief-of-staff');
    expect(view.usage).toEqual({
      day: TODAY,
      team: { used: 1, cap: 9 },
      byRole: { [role.id]: { used: 1, cap: 4 } },
    });
    expect(view.limits).toEqual({ maxBriefChars: 4000, maxRoles: 12 });
    expect(view.fileRolesEnabled).toBe(false);
  });

  it('shows only this person’s roles and runs', async () => {
    const { service } = setup();
    const role = await makeRole(service);
    await service.assign(actor, role.id, { requestId: 'req-00000001', task: 'a' });
    const view = await service.overview(other);
    expect(view.roles).toEqual([]);
    expect(view.runs).toEqual([]);
  });

  it.each([
    ['running', 'running'],
    ['requires_action', 'paused'],
    ['complete', 'done'],
    ['error', 'failed'],
    ['aborted', 'failed'],
  ] as const)('shows a %s generation as %s and keeps it once finished', async (job, status) => {
    const { service, setJob } = setup();
    const role = await makeRole(service);
    await service.assign(actor, role.id, { requestId: 'req-00000001', task: 'a' });
    setJob(job);
    const first = (await service.overview(user)).runs[0];
    expect(first.status).toBe(status);
    if (status === 'done' || status === 'failed') {
      expect(first.finishedAt).toBeDefined();
      setJob(null);
      expect((await service.overview(user)).runs[0].status).toBe(status);
    }
  });

  it('shows a run nobody knows about as queued at first and unknown later', async () => {
    const { service, setNow } = setup();
    const role = await makeRole(service);
    await service.assign(actor, role.id, { requestId: 'req-00000001', task: 'a' });
    expect((await service.overview(user)).runs[0].status).toBe('queued');
    setNow(new Date(NOW.getTime() + 11 * 60_000));
    expect((await service.overview(user)).runs[0].status).toBe('unknown');
  });

  it('never puts provider error text on a run', async () => {
    const { service, setJob } = setup();
    const role = await makeRole(service);
    await service.assign(actor, role.id, { requestId: 'req-00000001', task: 'a' });
    setJob('error');
    const run = (await service.overview(user)).runs[0];
    expect(run.error).toBe('run_error');
  });
});

describe('roles that run on a host agent', () => {
  let tasks: string;
  let store: BridgeStore;
  const FILE_ON = { fileRolesEnabled: true };

  beforeEach(async () => {
    tasks = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-host-roles-'));
    for (const dir of ['inbox', 'processing', 'outbox', 'archive']) {
      await fs.mkdir(path.join(tasks, dir));
    }
    store = createBridgeStore({ tasksDir: tasks, maxResultBytes: 4096 });
  });
  afterEach(async () => {
    await fs.rm(tasks, { recursive: true, force: true });
  });

  const host = (over: Overrides = {}) =>
    setup({ settings: FILE_ON, store, tasksDir: tasks, ...over });
  const makeHostRole = async (service: ReturnType<typeof setup>['service'], over = {}) => {
    const made = await service.createRole(actor, {
      name: 'SEO Strategist',
      runtime: 'hermes',
      roleFile: 'seo-strategist-sbuddy',
      ...over,
    });
    if (!made.ok) {
      throw new Error(`could not create role: ${made.error.code}`);
    }
    return made.value;
  };
  const inbox = () => fs.readdir(path.join(tasks, 'inbox'));
  const move = (id: string, from: string, to: string) =>
    fs.rename(path.join(tasks, from, `${id}.md`), path.join(tasks, to, `${id}.md`));
  const answer = (id: string, text: string) =>
    fs.writeFile(path.join(tasks, 'outbox', `${id}-result.md`), text);

  it('stay locked until the operator opens them', async () => {
    const { service } = setup({ store, tasksDir: tasks });
    const result = await service.createRole(actor, {
      name: 'X',
      runtime: 'hermes',
      roleFile: 'seo-strategist-sbuddy',
    });
    expect(!result.ok && result.error.code).toBe('ROLE_LOCKED');
  });

  it('are created from a role file name, with no agent', async () => {
    const { service } = host();
    const role = await makeHostRole(service);
    expect(role).toMatchObject({ runtime: 'hermes', roleFile: 'seo-strategist-sbuddy', tier: 0 });
    expect(role.agentId).toBeUndefined();
    expect(role.brief).toBe('');
  });

  it.each([
    ['a path out of the roles folder', { roleFile: '../secrets' }, 'roleFile'],
    ['a name with capitals', { roleFile: 'Seo' }, 'roleFile'],
    ['no role file', { roleFile: undefined }, 'roleFile'],
    ['an agent as well', { agentId: 'agent_one' }, 'agentId'],
    ['a template', { templateId: 'writer' }, 'templateId'],
  ])('refuse %s', async (_label, over, field) => {
    const { service } = host();
    const result = await service.createRole(actor, {
      name: 'X',
      runtime: 'openclaw',
      roleFile: 'chief-of-staff',
      ...over,
    });
    expect(!result.ok && result.error).toEqual({ code: 'ROLE_INVALID', field });
  });

  it('write one task file that points the agent at its role file, and send nothing to the chat queue', async () => {
    const { service, sent } = host();
    const role = await makeHostRole(service);
    const result = await service.assign(actor, role.id, {
      requestId: 'req-00000001',
      task: 'Plan the next 90 days of local SEO',
    });
    expect(result.ok && result.value.replayed).toBe(false);
    const run = result.ok ? result.value.run : undefined;
    expect(run).toMatchObject({
      runtime: 'hermes',
      status: 'queued',
      counted: true,
      summary: 'Plan the next 90 days of local SEO',
    });
    expect(run?.conversationId).toBeUndefined();
    expect(sent).toHaveLength(0);

    const files = await inbox();
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(`${run?.taskId}.md`);
    expect(run?.taskId).toMatch(/-hermes-seo-strategist-sbuddy-plan-the-next/);
    const text = await fs.readFile(path.join(tasks, 'inbox', files[0]), 'utf8');
    expect(text).toContain('to: hermes');
    expect(text).toContain(
      `Follow the role file ${tasks}/roles/seo-strategist-sbuddy.md exactly. Task: Plan the next 90 days of local SEO.`,
    );
    expect(text).toContain('via: mindferry');
  });

  it('do not write a second file for the same request id', async () => {
    const { service } = host();
    const role = await makeHostRole(service);
    const body = { requestId: 'req-00000001', task: 'Plan' };
    const first = await service.assign(actor, role.id, body);
    const again = await service.assign(actor, role.id, body);
    expect(again.ok && again.value.replayed).toBe(true);
    expect(again.ok && first.ok && again.value.run.id).toBe(first.ok && first.value.run.id);
    expect(await inbox()).toHaveLength(1);
  });

  it('count against the same daily caps and stop before writing a file', async () => {
    const { service } = host({ settings: { ...FILE_ON, dailyCapPerRole: 1 } });
    const role = await makeHostRole(service);
    await service.assign(actor, role.id, { requestId: 'req-00000001', task: 'one' });
    const second = await service.assign(actor, role.id, { requestId: 'req-00000002', task: 'two' });
    expect(!second.ok && second.error).toMatchObject({ code: 'CAP_ROLE', cap: 1 });
    expect(await inbox()).toHaveLength(1);
    expect((await service.overview(user)).usage.team.used).toBe(1);
  });

  it('refuse a task a file cannot hold, and a key in the task, before writing', async () => {
    const { service } = host();
    const role = await makeHostRole(service);
    const long = await service.assign(actor, role.id, {
      requestId: 'req-00000001',
      task: 'a'.repeat(1990),
    });
    expect(!long.ok && long.error).toEqual({ code: 'ROLE_INVALID', field: 'task' });
    const secret = await service.assign(actor, role.id, {
      requestId: 'req-00000002',
      task: 'use sk-ant-api03-abcdefghijklmnopqrstuvwx',
    });
    expect(!secret.ok && secret.error.code).toBe('ROLE_SECRET_DETECTED');
    expect(await inbox()).toHaveLength(0);
    expect((await service.overview(user)).usage.team.used).toBe(0);
  });

  it('give the slot back when the task file could not be written', async () => {
    const broken: BridgeStore = {
      ...store,
      create: async () => {
        throw new Error('inbox is read-only');
      },
    };
    const { service } = host({ store: broken });
    const role = await makeHostRole(service);
    const result = await service.assign(actor, role.id, { requestId: 'req-00000001', task: 'x' });
    expect(!result.ok && result.error.code).toBe('ASSIGN_FAILED');
    const view = await service.overview(user);
    expect(view.usage.team.used).toBe(0);
    expect(view.runs[0]).toMatchObject({
      status: 'failed',
      error: 'task_not_written',
      counted: false,
    });
  });

  it('follow the task folder: queued, running, then the result', async () => {
    const { service } = host();
    const role = await makeHostRole(service);
    const made = await service.assign(actor, role.id, { requestId: 'req-00000001', task: 'Plan' });
    const id = made.ok ? (made.value.run.taskId as string) : '';
    const status = async () => (await service.overview(user)).runs[0];

    expect((await status()).status).toBe('queued');
    await move(id, 'inbox', 'processing');
    expect((await status()).status).toBe('running');
    await answer(id, 'status: DONE\n\nDone.');
    const done = await status();
    expect(done.status).toBe('done');
    expect(done.finishedAt).toBeDefined();
    await move(id, 'processing', 'archive');
    expect((await status()).status).toBe('done');
  });

  it('show a failed result as failed, with a fixed code and never the agent text', async () => {
    const { service } = host();
    const role = await makeHostRole(service);
    const made = await service.assign(actor, role.id, { requestId: 'req-00000001', task: 'Plan' });
    const id = made.ok ? (made.value.run.taskId as string) : '';
    await move(id, 'inbox', 'processing');
    await answer(id, 'status: FAILED\n\nmongodb://admin:hunter2@db refused');
    const run = (await service.overview(user)).runs[0];
    expect(run).toMatchObject({ status: 'failed', error: 'task_failed' });
    expect(JSON.stringify(run)).not.toContain('hunter2');
  });

  it('hint that a run may be stuck after an hour with no result, and show a vanished file as unknown', async () => {
    const { service, setNow } = host();
    const role = await makeHostRole(service);
    const made = await service.assign(actor, role.id, { requestId: 'req-00000001', task: 'Plan' });
    const id = made.ok ? (made.value.run.taskId as string) : '';
    await move(id, 'inbox', 'processing');
    expect((await service.overview(user)).runs[0].stuck).toBeUndefined();
    setNow(new Date(NOW.getTime() + 61 * 60_000));
    const stuck = (await service.overview(user)).runs[0];
    expect(stuck).toMatchObject({ status: 'running', stuck: true });

    await fs.rm(path.join(tasks, 'processing', `${id}.md`));
    expect((await service.overview(user)).runs[0].status).toBe('unknown');
  });

  it('keep an in-app run and a host run apart in the same list', async () => {
    const { service } = host();
    const app = await makeRole(service);
    const hostRole = await makeHostRole(service);
    await service.assign(actor, app.id, { requestId: 'req-00000001', task: 'in app' });
    await service.assign(actor, hostRole.id, { requestId: 'req-00000002', task: 'on host' });
    const runs = (await service.overview(user)).runs;
    expect(runs.map((r) => r.runtime).sort()).toEqual(['app', 'hermes']);
    expect(runs.find((r) => r.runtime === 'app')?.conversationId).toBeDefined();
    expect(runs.find((r) => r.runtime === 'hermes')?.taskId).toBeDefined();
  });

  it('refuse to hand a task to a host role while the operator has closed them again', async () => {
    const open = host();
    const role = await makeHostRole(open.service);
    const closed = setup({ store, tasksDir: tasks });
    const result = await closed.service.assign(actor, role.id, {
      requestId: 'req-00000001',
      task: 'x',
    });
    expect(!result.ok && result.error.code).toBe('ROLE_LOCKED');
    expect(await inbox()).toHaveLength(0);
  });
});
