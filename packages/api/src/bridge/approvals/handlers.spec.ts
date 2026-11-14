import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { promises as fs } from 'fs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { AppConfig } from '@librechat/data-schemas';
import type { AgentTriggerEnvelope } from '../../agents/triggers/envelope';
import { createApprovalsHandlers } from './handlers';

let mongo: MongoMemoryServer;
let methods: ReturnType<typeof createMethods>;
let tasksDir: string;
const user = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { args: ['--nounixsocket'] } });
  await mongoose.connect(mongo.getUri());
  createModels(mongoose);
  methods = createMethods(mongoose);
  await Promise.all([
    mongoose.models.BridgeRole.init(),
    mongoose.models.BridgeRun.init(),
    mongoose.models.BridgeProposal.init(),
    mongoose.models.BridgeAudit.init(),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

let config: Partial<AppConfig> | undefined;
let signedIn = true;
let sent: AgentTriggerEnvelope[];

/** The handlers take the server's own request type; express only needs them to be callable. */
const route = (handler: unknown) => handler as express.RequestHandler;

function build() {
  const handlers = createApprovalsHandlers({
    methods,
    enqueueTrigger: async (envelope) => {
      sent.push(envelope);
    },
    getJobStatus: async () => null,
    resolveAgent: async (_actor, agentId) => ({ id: agentId, provider: 'anthropic', model: 'm' }),
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { config?: unknown }).config = config;
    if (signedIn) {
      (req as unknown as { user?: unknown }).user = { id: user, role: 'ADMIN' };
    }
    next();
  });
  app.get('/approvals', route(handlers.overview));
  app.post('/approvals', route(handlers.create));
  app.post('/approvals/:id/decide', route(handlers.decide));
  app.get('/audit', route(handlers.audit));
  return app;
}

beforeEach(async () => {
  tasksDir = await fs.mkdtemp(path.join(os.tmpdir(), 'approvals-'));
  for (const folder of ['inbox', 'processing', 'outbox', 'archive']) {
    await fs.mkdir(path.join(tasksDir, folder));
  }
  config = {
    agentBridge: {
      enabled: true,
      tasksDir,
      roles: { enabled: true, fileRolesEnabled: true },
      approvals: { enabled: true },
    },
  } as unknown as Partial<AppConfig>;
  signedIn = true;
  sent = [];
  await Promise.all(
    ['BridgeRole', 'BridgeRun', 'BridgeProposal'].map((name) =>
      mongoose.models[name].deleteMany({}),
    ),
  );
  await mongoose.models.BridgeAudit.collection.deleteMany({});
});

afterEach(async () => {
  await fs.rm(tasksDir, { recursive: true, force: true });
});

async function role(runtime: 'hermes' | 'app' = 'hermes'): Promise<string> {
  const made = await methods.createBridgeRole(
    user,
    {
      slug: `role-${runtime}`,
      name: `Role ${runtime}`,
      runtime,
      ...(runtime === 'hermes' ? { roleFile: 'seo-strategist-petvee' } : { agentId: 'agent_abc' }),
    },
    50,
  );
  if (!made.ok) {
    throw new Error('role not created');
  }
  return made.role.id;
}

const REQ = (n: number | string) => `request-${n}-abcdefgh`;

async function propose(app: express.Express, roleId: string, task = 'Draft the listing', n = 1) {
  const res = await request(app)
    .post('/approvals')
    .send({ requestId: REQ(n), roleId, task });
  expect(res.status).toBe(201);
  return res.body as { id: string; hash: string; status: string; content: string };
}

describe('access', () => {
  it.each([
    ['the bridge is off', { agentBridge: { enabled: false } }],
    [
      'roles are off',
      { agentBridge: { enabled: true, roles: { enabled: false }, approvals: { enabled: true } } },
    ],
    ['approvals are off', { agentBridge: { enabled: true, roles: { enabled: true } } }],
    ['there is no config', undefined],
  ])('answers 404 when %s', async (_name, value) => {
    config = value as Partial<AppConfig> | undefined;
    const app = build();
    for (const res of [
      await request(app).get('/approvals'),
      await request(app).post('/approvals').send({}),
      await request(app).post('/approvals/x/decide').send({}),
      await request(app).get('/audit'),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'BRIDGE_DISABLED' });
    }
  });

  it('answers 401 with no signed-in user and never caches', async () => {
    signedIn = false;
    const res = await request(build()).get('/approvals');
    expect(res.status).toBe(401);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('the queue', () => {
  it('creates, lists, and rejects bad bodies and a repeated request id', async () => {
    const app = build();
    const roleId = await role();
    const created = await propose(app, roleId);
    expect(created.status).toBe('pending');
    const again = await request(app)
      .post('/approvals')
      .send({ requestId: REQ(1), roleId, task: 'other' });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(created.id);
    const listed = await request(app).get('/approvals');
    expect(listed.status).toBe(200);
    expect(listed.body.proposals).toHaveLength(1);
    expect(listed.body.pending).toBe(1);
    expect(
      (
        await request(app)
          .post('/approvals')
          .send({ requestId: REQ(2) })
      ).body,
    ).toEqual({
      error: 'APPROVAL_INVALID',
      field: 'roleId',
    });
    expect(
      (
        await request(app)
          .post('/approvals')
          .send({ requestId: REQ(3), roleId, task: 'x', extra: 1 })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/approvals')
          .send({
            requestId: REQ(4),
            roleId,
            task: 'key sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE00',
          })
      ).status,
    ).toBe(400);
    const missing = await request(app)
      .post('/approvals')
      .send({ requestId: REQ(5), roleId: new mongoose.Types.ObjectId().toString(), task: 'x' });
    expect(missing.status).toBe(409);
    expect(missing.body.error).toBe('APPROVAL_ROLE_UNAVAILABLE');
  });

  it('answers 429 over the pending limit', async () => {
    config = {
      agentBridge: {
        enabled: true,
        tasksDir,
        roles: { enabled: true, fileRolesEnabled: true },
        approvals: { enabled: true, maxPending: 1 },
      },
    } as unknown as Partial<AppConfig>;
    const app = build();
    const roleId = await role();
    await propose(app, roleId, 'one', 1);
    const over = await request(app)
      .post('/approvals')
      .send({ requestId: REQ(2), roleId, task: 'two' });
    expect(over.status).toBe(429);
    expect(over.body).toEqual({ error: 'APPROVAL_LIMIT', cap: 1 });
  });
});

describe('approving', () => {
  it('writes the task file for a host role with exactly the approved text, and links the run', async () => {
    const app = build();
    const roleId = await role('hermes');
    const proposal = await propose(app, roleId, 'Draft the Google Play description');
    const res = await request(app)
      .post(`/approvals/${proposal.id}/decide`)
      .send({ decision: 'approve', hash: proposal.hash });
    expect(res.status).toBe(200);
    expect(res.body.proposal.status).toBe('approved');
    expect(res.body.run.runtime).toBe('hermes');
    expect(res.body.proposal.runId).toBe(res.body.run.id);
    const files = await fs.readdir(path.join(tasksDir, 'inbox'));
    expect(files).toHaveLength(1);
    const text = await fs.readFile(path.join(tasksDir, 'inbox', files[0]), 'utf8');
    expect(text).toContain(
      'seo-strategist-petvee.md exactly. Task: Draft the Google Play description',
    );
  });

  it('starts an in-app run for an app role', async () => {
    const app = build();
    const roleId = await role('app');
    const proposal = await propose(app, roleId, 'Plan the week');
    const res = await request(app)
      .post(`/approvals/${proposal.id}/decide`)
      .send({ decision: 'approve', hash: proposal.hash });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(res.body.run.runtime).toBe('app');
  });

  it('starts exactly one run when the same approval arrives twice at once', async () => {
    const app = build();
    const roleId = await role('hermes');
    const proposal = await propose(app, roleId);
    const body = { decision: 'approve', hash: proposal.hash };
    const [one, two] = await Promise.all([
      request(app).post(`/approvals/${proposal.id}/decide`).send(body),
      request(app).post(`/approvals/${proposal.id}/decide`).send(body),
    ]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(await mongoose.models.BridgeRun.countDocuments({})).toBe(1);
    expect(await fs.readdir(path.join(tasksDir, 'inbox'))).toHaveLength(1);
    const again = await request(app).post(`/approvals/${proposal.id}/decide`).send(body);
    expect(again.status).toBe(200);
    expect(await mongoose.models.BridgeRun.countDocuments({})).toBe(1);
  });

  it('answers 409 for a wrong hash and 400 for a missing one, and writes nothing', async () => {
    const app = build();
    const proposal = await propose(app, await role());
    const wrong = await request(app)
      .post(`/approvals/${proposal.id}/decide`)
      .send({ decision: 'approve', hash: 'c'.repeat(64) });
    expect(wrong.status).toBe(409);
    expect(wrong.body).toEqual({ error: 'APPROVAL_HASH_MISMATCH' });
    const missing = await request(app)
      .post(`/approvals/${proposal.id}/decide`)
      .send({ decision: 'approve' });
    expect(missing.status).toBe(400);
    expect(await fs.readdir(path.join(tasksDir, 'inbox'))).toEqual([]);
  });

  it('answers 502 with the cause when the hand-over is stopped, and the proposal stays approved', async () => {
    config = {
      agentBridge: {
        enabled: true,
        tasksDir,
        roles: { enabled: true, fileRolesEnabled: true, dailyCapPerRole: 1 },
        approvals: { enabled: true },
      },
    } as unknown as Partial<AppConfig>;
    const app = build();
    const roleId = await role();
    const first = await propose(app, roleId, 'one', 1);
    const second = await propose(app, roleId, 'two', 2);
    await request(app)
      .post(`/approvals/${first.id}/decide`)
      .send({ decision: 'approve', hash: first.hash });
    const stopped = await request(app)
      .post(`/approvals/${second.id}/decide`)
      .send({ decision: 'approve', hash: second.hash });
    expect(stopped.status).toBe(502);
    expect(stopped.body.error).toBe('APPROVAL_HANDOVER_FAILED');
    expect(stopped.body.cause).toBe('CAP_ROLE');
    expect(stopped.body.proposal.status).toBe('approved');
    const lines = (await request(app).get(`/audit?proposalId=${second.id}`)).body.lines;
    expect(lines.map((line: { action: string }) => line.action)).toEqual([
      'handover_failed',
      'proposal_approved',
      'proposal_created',
    ]);
    expect(lines[0].detail).toBe('CAP_ROLE');
  });
});

describe('denying and the ledger', () => {
  it('denies without writing a task file, and answers 409 to a later approval', async () => {
    const app = build();
    const proposal = await propose(app, await role());
    const denied = await request(app)
      .post(`/approvals/${proposal.id}/decide`)
      .send({ decision: 'deny' });
    expect(denied.status).toBe(200);
    expect(denied.body.proposal.status).toBe('denied');
    expect(denied.body.run).toBeUndefined();
    expect(await fs.readdir(path.join(tasksDir, 'inbox'))).toEqual([]);
    const late = await request(app)
      .post(`/approvals/${proposal.id}/decide`)
      .send({ decision: 'approve', hash: proposal.hash });
    expect(late.status).toBe(409);
    expect(late.body).toEqual({ error: 'APPROVAL_NOT_PENDING' });
  });

  it('answers 404 for an unknown proposal and 400 for a bad decision', async () => {
    const app = build();
    const missing = await request(app)
      .post(`/approvals/${new mongoose.Types.ObjectId()}/decide`)
      .send({ decision: 'deny' });
    expect(missing.status).toBe(404);
    expect(
      (await request(app).post('/approvals/x/decide').send({ decision: 'maybe' })).status,
    ).toBe(400);
  });

  it('shows the ledger, filtered by proposal, with no proposal text in it', async () => {
    const app = build();
    const proposal = await propose(app, await role(), 'Draft the private listing');
    await request(app).post(`/approvals/${proposal.id}/decide`).send({ decision: 'deny' });
    const all = (await request(app).get('/audit')).body.lines;
    expect(all.map((line: { action: string }) => line.action)).toEqual([
      'proposal_denied',
      'proposal_created',
    ]);
    expect(JSON.stringify(all)).not.toContain('private listing');
    expect((await request(app).get('/audit?proposalId=nope')).body.lines).toEqual([]);
  });
});
