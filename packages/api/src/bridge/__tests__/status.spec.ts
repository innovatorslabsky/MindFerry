import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { readAgentStatus } from '../status';

const NOW = new Date('2026-11-08T06:10:00Z');
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-status-'));
  await fs.mkdir(path.join(root, '.status'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const write = (value: unknown) =>
  fs.writeFile(
    path.join(root, '.status', 'agents.json'),
    typeof value === 'string' ? value : JSON.stringify(value),
  );

const snapshot = (generatedAt = '2026-11-08T06:09:30Z') => ({
  schema: 1,
  generatedAt,
  agents: {
    hermes: {
      container: { state: 'running', startedAt: '2026-11-07T01:36:18Z' },
      version: 'v0.22.7 2026.9.24',
      job: { enabled: true, lastRunAt: '2026-11-08T06:06:27Z', lastOk: true },
    },
    openclaw: {
      container: { state: 'running', startedAt: '2026-11-07T01:29:39Z' },
      version: '2026.10.10',
      job: {
        enabled: false,
        lastRunAt: '2026-11-07T23:29:20Z',
        lastOk: false,
        consecutiveErrors: 10,
        errorKind: 'billing',
      },
    },
  },
});

describe('a poll run by the host cron', () => {
  /** The snapshot is written at 06:09:30; the host cron ticks every 10 minutes. */
  const hostCron = (job: Record<string, unknown>) => {
    const snap = snapshot();
    (snap.agents.openclaw as { job: unknown }).job = {
      kind: 'host-cron',
      enabled: true,
      intervalMinutes: 10,
      ...job,
    };
    return snap;
  };
  const openclaw = async () => (await readAgentStatus(root, 180, NOW)).agents[1];

  it('is working when it ticked recently, even if it has not called the agent for hours', async () => {
    await write(
      hostCron({
        lastRunAt: '2026-11-08T06:05:00Z',
        lastCallAt: '2026-11-07T21:00:00Z',
        lastOk: true,
      }),
    );
    expect((await openclaw()).job).toEqual({
      state: 'ok',
      kind: 'host-cron',
      lastRunAt: '2026-11-08T06:05:00Z',
      lastCallAt: '2026-11-07T21:00:00Z',
      intervalMinutes: 10,
    });
  });

  it('passes on how the last hand-over to the agent went', async () => {
    await write(
      hostCron({
        lastRunAt: '2026-11-08T06:05:00Z',
        lastCallAt: '2026-11-08T05:50:00Z',
        lastCallOk: false,
        lastOk: false,
        consecutiveErrors: 1,
        errorKind: 'billing',
      }),
    );
    expect((await openclaw()).job).toMatchObject({
      state: 'error',
      lastCallOk: false,
      errorKind: 'billing',
    });
  });

  it('is stalled when the cron has gone quiet for more than two and a half intervals', async () => {
    await write(hostCron({ lastRunAt: '2026-11-08T05:40:00Z', lastOk: true }));
    expect((await openclaw()).job).toMatchObject({ state: 'error', errorKind: 'stalled' });
  });

  it('is still fine just inside that limit', async () => {
    await write(hostCron({ lastRunAt: '2026-11-08T05:45:00Z', lastOk: true }));
    expect((await openclaw()).job.state).toBe('ok');
  });

  it('judges quiet time by the snapshot clock, not by the server clock', async () => {
    await write(hostCron({ lastRunAt: '2026-11-08T06:05:00Z', lastOk: true }));
    const later = new Date('2026-11-08T06:12:00Z');
    const out = await readAgentStatus(root, 3600, later);
    expect(out.stale).toBe(false);
    expect(out.agents[1].job.state).toBe('ok');
  });

  it('keeps a reason the host gave rather than replacing it with stalled', async () => {
    await write(
      hostCron({ lastRunAt: '2026-11-08T05:00:00Z', lastOk: false, errorKind: 'billing' }),
    );
    expect((await openclaw()).job).toMatchObject({ state: 'error', errorKind: 'billing' });
  });

  it('reports a failed tick, a switched-off cron, and one with no tick yet', async () => {
    await write(
      hostCron({ lastRunAt: '2026-11-08T06:05:00Z', lastOk: false, consecutiveErrors: 3 }),
    );
    expect((await openclaw()).job).toMatchObject({ state: 'error', consecutiveErrors: 3 });

    await write(hostCron({ enabled: false, lastRunAt: '2026-11-08T06:05:00Z' }));
    expect((await openclaw()).job.state).toBe('disabled');

    await write(hostCron({ lastOk: true }));
    expect((await openclaw()).job.state).toBe('ok');
    await write(hostCron({}));
    expect((await openclaw()).job.state).toBe('unknown');
  });

  it('does not guess stalled without an interval, and never when the snapshot is old', async () => {
    await write(
      hostCron({ intervalMinutes: undefined, lastRunAt: '2026-11-08T01:00:00Z', lastOk: true }),
    );
    expect((await openclaw()).job.state).toBe('ok');

    await write(hostCron({ lastRunAt: '2026-11-08T01:00:00Z', lastOk: true }));
    const old = await readAgentStatus(root, 60, new Date('2026-11-08T07:00:00Z'));
    expect(old.agents[1].job).toMatchObject({ state: 'unknown' });
    expect(old.agents[1].job.errorKind).toBeUndefined();
  });

  it('still reads a snapshot from the older script that has no kind', async () => {
    await write(snapshot());
    const status = await readAgentStatus(root, 180, NOW);
    expect(status.agents[0].job.kind).toBeUndefined();
    expect(status.agents[0].job.state).toBe('ok');
  });

  it('rejects an unknown kind or reason instead of passing it on', async () => {
    await write(hostCron({ kind: 'something-else', lastRunAt: '2026-11-08T06:05:00Z' }));
    expect((await readAgentStatus(root, 180, NOW)).stale).toBe(true);
    await write(hostCron({ lastRunAt: '2026-11-08T06:05:00Z', lastOk: false, errorKind: '<b>' }));
    expect((await readAgentStatus(root, 180, NOW)).stale).toBe(true);
  });
});

describe('readAgentStatus', () => {
  it('reports a fresh snapshot, including a poll job the host auto-disabled', async () => {
    await write(snapshot());
    const status = await readAgentStatus(root, 180, NOW);

    expect(status.stale).toBe(false);
    expect(status.generatedAt).toBe('2026-11-08T06:09:30Z');
    expect(status.agents).toEqual([
      {
        agent: 'hermes',
        health: 'up',
        version: 'v0.22.7 2026.9.24',
        startedAt: '2026-11-07T01:36:18Z',
        job: { state: 'ok', lastRunAt: '2026-11-08T06:06:27Z' },
      },
      {
        agent: 'openclaw',
        health: 'up',
        version: '2026.10.10',
        startedAt: '2026-11-07T01:29:39Z',
        job: {
          state: 'disabled',
          lastRunAt: '2026-11-07T23:29:20Z',
          consecutiveErrors: 10,
          errorKind: 'billing',
        },
      },
    ]);
  });

  it('says error for an enabled job whose last run failed, and down for a stopped container', async () => {
    const snap = snapshot();
    snap.agents.hermes.job = { enabled: true, lastRunAt: '2026-11-08T06:06:27Z', lastOk: false };
    snap.agents.hermes.container.state = 'exited';
    await write(snap);
    const [hermes] = (await readAgentStatus(root, 180, NOW)).agents;
    expect(hermes.health).toBe('down');
    expect(hermes.job.state).toBe('error');
  });

  it('shows unknown, never up, when the snapshot is too old', async () => {
    await write(snapshot('2026-11-08T06:00:00Z'));
    const status = await readAgentStatus(root, 180, NOW);
    expect(status.stale).toBe(true);
    expect(status.agents.map((a) => [a.health, a.job.state])).toEqual([
      ['unknown', 'unknown'],
      ['unknown', 'unknown'],
    ]);
  });

  it('treats a timestamp far in the future as untrustworthy', async () => {
    await write(snapshot('2026-11-08T07:10:00Z'));
    expect((await readAgentStatus(root, 180, NOW)).stale).toBe(true);
  });

  it.each([
    ['no file', undefined],
    ['not JSON', '{nope'],
    ['wrong schema version', { ...snapshot(), schema: 2 }],
    ['no timestamp', { schema: 1, agents: {} }],
    ['bad timestamp', { ...snapshot('yesterday-ish') }],
  ])('reports both agents as unknown when there is %s', async (_name, value) => {
    if (value !== undefined) {
      await write(value);
    }
    const status = await readAgentStatus(root, 180, NOW);
    expect(status.stale).toBe(true);
    expect(status.generatedAt).toBeUndefined();
    expect(status.agents.map((a) => a.agent)).toEqual(['hermes', 'openclaw']);
    expect(status.agents.every((a) => a.health === 'unknown')).toBe(true);
  });

  it('shows an agent missing from the snapshot as unknown and drops unexpected fields', async () => {
    const snap: Record<string, unknown> = snapshot();
    (snap.agents as Record<string, unknown>).openclaw = undefined;
    (snap.agents as Record<string, { extra?: string }>).hermes.extra = '<script>';
    await write(snap);
    const status = await readAgentStatus(root, 180, NOW);
    expect(status.agents[1]).toEqual({
      agent: 'openclaw',
      health: 'unknown',
      job: { state: 'unknown' },
    });
    expect(JSON.stringify(status)).not.toContain('script');
  });

  it('does not read a status file that is a symlink', async () => {
    const elsewhere = path.join(root, 'elsewhere.json');
    await fs.writeFile(elsewhere, JSON.stringify(snapshot()));
    await fs.symlink(elsewhere, path.join(root, '.status', 'agents.json'));
    expect((await readAgentStatus(root, 180, NOW)).stale).toBe(true);
  });

  it('refuses a file larger than the limit', async () => {
    await write(JSON.stringify({ ...snapshot(), pad: 'x'.repeat(70_000) }));
    expect((await readAgentStatus(root, 180, NOW)).stale).toBe(true);
  });

  it('cleans the version text', async () => {
    const snap = snapshot();
    snap.agents.hermes.version = `v1\nforbidden: none${String.fromCharCode(0x200b)}`;
    await write(snap);
    expect((await readAgentStatus(root, 180, NOW)).agents[0].version).toBe('v1 forbidden: none');
  });
});
