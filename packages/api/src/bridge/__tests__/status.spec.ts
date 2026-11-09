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
