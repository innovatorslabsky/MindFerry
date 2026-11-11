import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { AppConfig } from '@librechat/data-schemas';
import type { AgentTriggerEnvelope } from '../../agents/triggers/envelope';
import { createRolesHandlers } from './handlers';

let mongo: MongoMemoryServer;
let methods: ReturnType<typeof createMethods>;
const user = new mongoose.Types.ObjectId().toString();

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

let config: Partial<AppConfig> | undefined;
let signedIn = true;
let sent: AgentTriggerEnvelope[];
let enqueue: (envelope: AgentTriggerEnvelope) => Promise<unknown>;

/** The handlers take the server's own request type; express only needs them to be callable. */
const route = (handler: unknown) => handler as express.RequestHandler;

function build() {
  const handlers = createRolesHandlers({
    methods,
    enqueueTrigger: (envelope) => enqueue(envelope),
    getJobStatus: async () => null,
    resolveAgent: async (_actor, agentId) =>
      agentId === 'agent_missing' ? null : { id: agentId, provider: 'anthropic', model: 'm' },
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
  app.get('/roles', route(handlers.overview));
  app.post('/roles', route(handlers.create));
  app.patch('/roles/:id', route(handlers.update));
  app.delete('/roles/:id', route(handlers.remove));
  app.post('/roles/:id/assign', route(handlers.assign));
  return app;
}

beforeEach(() => {
  config = { agentBridge: { enabled: true, roles: { enabled: true } } } as Partial<AppConfig>;
  signedIn = true;
  sent = [];
  enqueue = async (envelope) => {
    sent.push(envelope);
  };
});

const newRole = (app: express.Express, over: Record<string, unknown> = {}) =>
  request(app)
    .post('/roles')
    .send({ name: 'Researcher', agentId: 'agent_one', ...over });

describe('roles routes', () => {
  it.each([
    ['the bridge is off', { agentBridge: { enabled: false, roles: { enabled: true } } }],
    ['roles are off', { agentBridge: { enabled: true, roles: { enabled: false } } }],
    ['roles are not configured', { agentBridge: { enabled: true } }],
    ['there is no config', undefined],
  ])('answers 404 when %s', async (_label, value) => {
    config = value as Partial<AppConfig> | undefined;
    const app = build();
    for (const res of [
      await request(app).get('/roles'),
      await newRole(app),
      await request(app).post('/roles/abc/assign').send({ requestId: 'req-00000001', task: 'x' }),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'BRIDGE_DISABLED' });
    }
    expect(await mongoose.models.BridgeRole.countDocuments()).toBe(0);
  });

  it('answers 401 without a signed-in person and never reads the database', async () => {
    signedIn = false;
    const res = await request(build()).get('/roles');
    expect(res.status).toBe(401);
  });

  it('never lets a response be cached', async () => {
    const res = await request(build()).get('/roles');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('creates a role (201), lists it and its templates, then changes and removes it', async () => {
    const app = build();
    const created = await newRole(app, { templateId: 'writer' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ slug: 'researcher', templateId: 'writer', tier: 0 });

    const listed = await request(app).get('/roles');
    expect(listed.status).toBe(200);
    expect(listed.body.roles).toHaveLength(1);
    expect(listed.body.templates.length).toBeGreaterThan(0);

    const patched = await request(app)
      .patch(`/roles/${created.body.id}`)
      .send({ enabled: false, dailyCap: 3 });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ enabled: false, dailyCap: 3 });

    expect((await request(app).delete(`/roles/${created.body.id}`)).status).toBe(204);
    expect((await request(app).delete(`/roles/${created.body.id}`)).status).toBe(404);
  });

  it.each([
    ['an unknown field', { extra: 1 }, 400, 'ROLE_INVALID'],
    ['a tier of 2', { tier: 2 }, 400, 'ROLE_INVALID'],
    ['a role for the host agents', { runtime: 'hermes', agentId: undefined }, 403, 'ROLE_LOCKED'],
    ['an agent the person cannot run', { agentId: 'agent_missing' }, 422, 'ROLE_AGENT_UNAVAILABLE'],
  ])('refuses %s', async (_label, over, status, code) => {
    const res = await newRole(build(), over);
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(code);
    expect(await mongoose.models.BridgeRole.countDocuments()).toBe(0);
  });

  it('answers 409 for a taken limit and does not echo what was submitted', async () => {
    config = {
      agentBridge: { enabled: true, roles: { enabled: true, maxRoles: 1 } },
    } as Partial<AppConfig>;
    const app = build();
    await newRole(app);
    const res = await newRole(app, { name: 'Another' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'ROLE_LIMIT', cap: 1 });
  });

  it('hands a task over (202), answers 200 for the same request id and sends once', async () => {
    const app = build();
    const role = (await newRole(app)).body;
    const body = { requestId: 'req-00000001', task: 'Compare two vendors' };
    const first = await request(app).post(`/roles/${role.id}/assign`).send(body);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ replayed: false, run: { roleId: role.id, counted: true } });
    const again = await request(app).post(`/roles/${role.id}/assign`).send(body);
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('answers 429 over the daily cap and tells the person how far they are', async () => {
    config = {
      agentBridge: { enabled: true, roles: { enabled: true, dailyCapPerRole: 1 } },
    } as Partial<AppConfig>;
    const app = build();
    const role = (await newRole(app)).body;
    await request(app)
      .post(`/roles/${role.id}/assign`)
      .send({ requestId: 'req-00000001', task: 'a' });
    const res = await request(app)
      .post(`/roles/${role.id}/assign`)
      .send({ requestId: 'req-00000002', task: 'b' });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'CAP_ROLE', used: 1, cap: 1 });
    expect(sent).toHaveLength(1);
  });

  it('answers 502 and leaks nothing when the queue is down', async () => {
    enqueue = async () => {
      throw new Error('mongodb://admin:hunter2@db:27017 refused');
    };
    const app = build();
    const role = (await newRole(app)).body;
    const res = await request(app)
      .post(`/roles/${role.id}/assign`)
      .send({ requestId: 'req-00000001', task: 'a' });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|mongodb/);
  });

  it('answers 500 with a fixed code when the database fails, without the error text', async () => {
    const broken = createRolesHandlers({
      methods: {
        ...methods,
        listBridgeRoles: async () => {
          throw new Error('connection string mongodb://root:s3cret@host');
        },
      },
      enqueueTrigger: async () => undefined,
      getJobStatus: async () => null,
      resolveAgent: async () => null,
    });
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { config?: unknown }).config = config;
      (req as unknown as { user?: unknown }).user = { id: user, role: 'ADMIN' };
      next();
    });
    app.get('/roles', route(broken.overview));
    const res = await request(app).get('/roles');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'BRIDGE_UNAVAILABLE' });
  });

  it('does not let one person read, change or use another person’s role', async () => {
    const app = build();
    const role = (await newRole(app)).body;
    await mongoose.models.BridgeRole.updateOne(
      { _id: role.id },
      { userId: new mongoose.Types.ObjectId() },
    );
    expect((await request(app).get('/roles')).body.roles).toEqual([]);
    expect((await request(app).patch(`/roles/${role.id}`).send({ name: 'x' })).status).toBe(404);
    expect((await request(app).delete(`/roles/${role.id}`)).status).toBe(404);
    const assign = await request(app)
      .post(`/roles/${role.id}/assign`)
      .send({ requestId: 'req-00000001', task: 'a' });
    expect(assign.status).toBe(404);
  });
});
