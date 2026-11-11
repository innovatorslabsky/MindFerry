const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const express = require('express');
const request = require('supertest');

let mockConfig;

/** Stands in for sign-in: no role header means not signed in, like requireJwtAuth. */
jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, res, next) => {
    const role = req.headers['x-test-role'];
    if (!role) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.user = { id: 'user-1', role };
    return next();
  },
  configMiddleware: (req, res, next) => {
    req.config = mockConfig;
    return next();
  },
}));

const router = require('../bridge');

const ID = '2026-11-07-0143-hermes-readme-summary';
const body = { to: 'hermes', task: 'Read the README and write a summary' };

let root;
let app;

const as = (role) => ({ 'x-test-role': role });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-http-'));
  for (const dir of ['inbox', 'processing', 'outbox', 'archive']) {
    await fs.mkdir(path.join(root, dir));
  }
  mockConfig = { agentBridge: { enabled: true, tasksDir: root } };
  app = express();
  app.use(express.json());
  app.use('/api/bridge', router);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const inboxFiles = () => fs.readdir(path.join(root, 'inbox'));

describe('/api/bridge', () => {
  it('registers the task and role routes', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
    expect(paths).toEqual([
      'get /overview',
      'get /tasks/:id/result',
      'post /tasks',
      'get /roles',
      'post /roles',
      'patch /roles/:id',
      'delete /roles/:id',
      'post /roles/:id/assign',
    ]);
  });

  describe('without signing in', () => {
    it.each([
      ['get', '/api/bridge/overview'],
      ['get', `/api/bridge/tasks/${ID}/result`],
      ['post', '/api/bridge/tasks'],
    ])('answers 401 to %s %s and reveals nothing', async (method, url) => {
      const res = await request(app)[method](url).send(body);
      expect(res.status).toBe(401);
      expect(JSON.stringify(res.body)).not.toMatch(/BRIDGE|tasks|inbox/);
    });

    it('checks sign-in before it looks at the request, and writes nothing', async () => {
      const res = await request(app)
        .post('/api/bridge/tasks')
        .send({ ...body, task: 'password: hunter2hunter2' });
      expect(res.status).toBe(401);
      expect(await inboxFiles()).toEqual([]);
    });
  });

  describe('as someone who is not an admin', () => {
    it.each([
      ['get', '/api/bridge/overview'],
      ['get', `/api/bridge/tasks/${ID}/result`],
      ['post', '/api/bridge/tasks'],
    ])('answers 403 to %s %s', async (method, url) => {
      const res = await request(app)[method](url).set(as('USER')).send(body);
      expect(res.status).toBe(403);
    });

    it('writes nothing', async () => {
      await request(app).post('/api/bridge/tasks').set(as('USER')).send(body);
      expect(await inboxFiles()).toEqual([]);
    });
  });

  describe('as an admin', () => {
    it('answers 404 when the operator has not turned the bridge on', async () => {
      mockConfig = { agentBridge: { enabled: false, tasksDir: root } };
      const res = await request(app).get('/api/bridge/overview').set(as('ADMIN'));
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'BRIDGE_DISABLED' });
    });

    it('creates a task, lists it, and reads its result', async () => {
      const created = await request(app).post('/api/bridge/tasks').set(as('ADMIN')).send(body);
      expect(created.status).toBe(201);
      expect(created.body.created).toBe(true);
      expect(await inboxFiles()).toEqual([created.body.filename]);

      const overview = await request(app).get('/api/bridge/overview').set(as('ADMIN'));
      expect(overview.status).toBe(200);
      expect(overview.body.tasks).toMatchObject([{ id: created.body.id, state: 'queued' }]);
      expect(overview.headers['cache-control']).toBe('no-store');

      await fs.writeFile(
        path.join(root, 'outbox', `${created.body.id}-result.md`),
        'status: DONE\n\nall good',
      );
      const result = await request(app)
        .get(`/api/bridge/tasks/${created.body.id}/result`)
        .set(as('ADMIN'));
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ status: 'DONE', text: 'status: DONE\n\nall good' });
    });

    it('refuses a path-shaped id', async () => {
      const res = await request(app)
        .get('/api/bridge/tasks/..%2F..%2Fetc%2Fpasswd/result')
        .set(as('ADMIN'));
      expect(res.status).toBe(400);
    });

    it('refuses a secret and a bad body', async () => {
      const secret = await request(app)
        .post('/api/bridge/tasks')
        .set(as('ADMIN'))
        .send({ ...body, task: 'use sk-ant-api03-abcdefghijklmnopqrstuvwx' });
      expect(secret.status).toBe(400);
      expect(secret.body).toEqual({ error: 'BRIDGE_SECRET_DETECTED' });

      const bad = await request(app)
        .post('/api/bridge/tasks')
        .set(as('ADMIN'))
        .send({ ...body, to: 'root' });
      expect(bad.status).toBe(400);
      expect(await inboxFiles()).toEqual([]);
    });
  });
});
