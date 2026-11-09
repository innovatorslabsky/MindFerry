import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { createBridgeStore, BridgeConflictError, BridgeUnavailableError } from '../store';
import { parseFrontmatter } from '../protocol';

const NOW = new Date('2026-11-07T01:43:20Z');
const ID = '2026-11-07-0143-hermes-readme-summary';
const OTHER = '2026-11-06-1200-hermes-example-summary';
const LATER = '2026-11-08-0900-openclaw-check-page';

const taskFile = (id: string, task = 'Read the README', priority = 'normal') =>
  `---\nid: ${id}\nto: ${id.includes('openclaw') ? 'openclaw' : 'hermes'}\nfrom: kem\ncreated: 2026-11-07T01:43:00Z\npriority: ${priority}\ntask: ${task}\n---\n`;

let root: string;

async function put(dir: string, name: string, content: string): Promise<void> {
  await fs.writeFile(path.join(root, dir, name), content);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-'));
  for (const dir of ['inbox', 'processing', 'outbox', 'archive']) {
    await fs.mkdir(path.join(root, dir));
  }
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const store = (maxResultBytes = 131_072) => createBridgeStore({ tasksDir: root, maxResultBytes });

describe('list', () => {
  it('derives each task state from where its files are', async () => {
    await put('processing', `${ID}.md`, taskFile(ID));
    await put('outbox', `${ID}-result.md`, 'status: DONE\n\nbody');
    await put('archive', `${OTHER}.md`, taskFile(OTHER));
    await put('inbox', `${LATER}.md`, taskFile(LATER, 'Check the page', 'high'));

    const { tasks, truncated } = await store().list(50);

    expect(truncated).toBe(false);
    expect(tasks.map((task) => task.id)).toEqual([LATER, ID, OTHER]);
    expect(tasks[0]).toMatchObject({
      to: 'openclaw',
      state: 'queued',
      priority: 'high',
      summary: 'Check the page',
      hasResult: false,
    });
    expect(tasks[1]).toMatchObject({
      to: 'hermes',
      state: 'done',
      hasResult: true,
      resultStatus: 'DONE',
    });
    expect(tasks[2]).toMatchObject({ state: 'archived', hasResult: false });
  });

  it('shows a picked-up task as running until a result exists, and a FAILED one as failed', async () => {
    const failed = '2026-11-07-0200-hermes-broken';
    await put('processing', `${ID}.md`, taskFile(ID));
    await put('processing', `${failed}.md`, taskFile(failed));
    await put('outbox', `${failed}-result.md`, 'status: FAILED\n\nnope');

    const byId = Object.fromEntries((await store().list(50)).tasks.map((t) => [t.id, t]));
    expect(byId[ID].state).toBe('running');
    expect(byId[failed]).toMatchObject({ state: 'failed', resultStatus: 'FAILED' });
  });

  it('lists a result whose task file was filed away or removed', async () => {
    await put('outbox', `${ID}-result.md`, 'status: DONE');
    const { tasks } = await store().list(50);
    expect(tasks).toEqual([
      { id: ID, to: 'hermes', state: 'done', summary: '', hasResult: true, resultStatus: 'DONE' },
    ]);
  });

  it('shows only the newest tasks up to the limit and says there are more', async () => {
    await put('inbox', `${OTHER}.md`, taskFile(OTHER));
    await put('inbox', `${ID}.md`, taskFile(ID));
    await put('inbox', `${LATER}.md`, taskFile(LATER));

    const { tasks, truncated } = await store().list(2);
    expect(tasks.map((task) => task.id)).toEqual([LATER, ID]);
    expect(truncated).toBe(true);
  });

  it('ignores files that are not tasks: other names, dotfiles, temp files, folders', async () => {
    await put('inbox', 'README.md', 'x');
    await put('inbox', `.${ID}.md`, taskFile(ID));
    await put('inbox', `.${ID}.md.ab12.tmp`, taskFile(ID));
    await put('inbox', '2026-11-07-0143-someone-else-x.md', taskFile(ID));
    await fs.mkdir(path.join(root, 'inbox', `${ID}.md`));
    expect((await store().list(50)).tasks).toEqual([]);
  });

  it('does not list or read a task file that is a symlink', async () => {
    const secret = path.join(root, 'secret.txt');
    await fs.writeFile(secret, '---\ntask: leaked\n---\n');
    await fs.symlink(secret, path.join(root, 'inbox', `${ID}.md`));
    const { tasks } = await store().list(50);
    expect(tasks).toEqual([]);
    expect(JSON.stringify(tasks)).not.toContain('leaked');
  });

  it('treats a missing archive folder as empty but a missing inbox as unavailable', async () => {
    await fs.rmdir(path.join(root, 'archive'));
    await expect(store().list(10)).resolves.toMatchObject({ tasks: [] });

    await fs.rmdir(path.join(root, 'inbox'));
    await expect(store().list(10)).rejects.toBeInstanceOf(BridgeUnavailableError);
  });

  it('refuses a task folder that is itself a symlink', async () => {
    const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), 'elsewhere-'));
    try {
      await fs.rmdir(path.join(root, 'outbox'));
      await fs.symlink(elsewhere, path.join(root, 'outbox'));
      await expect(store().list(10)).rejects.toBeInstanceOf(BridgeUnavailableError);
    } finally {
      await fs.rm(elsewhere, { recursive: true, force: true });
    }
  });
});

describe('readResult', () => {
  it('returns the text with its status', async () => {
    await put('outbox', `${ID}-result.md`, 'status: DONE\n\n## Done\nfine');
    await expect(store().readResult(ID)).resolves.toEqual({
      id: ID,
      status: 'DONE',
      text: 'status: DONE\n\n## Done\nfine',
      truncated: false,
    });
  });

  it('cuts a long result at the limit and says so', async () => {
    await put('outbox', `${ID}-result.md`, `status: DONE\n${'x'.repeat(5000)}`);
    const result = await store(1024).readResult(ID);
    expect(result?.truncated).toBe(true);
    expect(Buffer.byteLength(result?.text ?? '')).toBeLessThanOrEqual(1024);
  });

  it('returns null for a missing result and for an id that is not a task id', async () => {
    await expect(store().readResult(ID)).resolves.toBeNull();
    await expect(store().readResult('../../etc/passwd')).resolves.toBeNull();
    await expect(store().readResult(`${ID}-result`)).resolves.toBeNull();
  });

  it('does not read through a symlink', async () => {
    const secret = path.join(root, 'secret.txt');
    await fs.writeFile(secret, 'status: DONE\nTOP SECRET');
    await fs.symlink(secret, path.join(root, 'outbox', `${ID}-result.md`));
    await expect(store().readResult(ID)).resolves.toBeNull();
  });

  it('strips NUL bytes', async () => {
    await put('outbox', `${ID}-result.md`, 'status: DONE\u0000\nok');
    expect((await store().readResult(ID))?.text).toBe('status: DONE\nok');
  });
});

describe('create', () => {
  const input = {
    to: 'hermes' as const,
    task: 'Read the README and write a summary',
    priority: 'normal' as const,
  };

  it('writes the file into inbox and leaves no temp file behind', async () => {
    const built = await store().create(input, NOW);

    expect(await fs.readdir(path.join(root, 'inbox'))).toEqual([built.filename]);
    const text = await fs.readFile(path.join(root, 'inbox', built.filename), 'utf8');
    expect(text).toBe(built.content);
    expect(parseFrontmatter(text)).toMatchObject({ id: built.id, to: 'hermes', via: 'mindferry' });
    const mode = (await fs.stat(path.join(root, 'inbox', built.filename))).mode & 0o777;
    expect(mode & 0o044).toBe(0o044);
  });

  it('never replaces an existing task: the same words in the same minute get a new id', async () => {
    const first = await store().create(input, NOW);
    const second = await store().create(input, NOW);
    expect(second.id).toBe(`${first.id}-2`);
    expect(await fs.readdir(path.join(root, 'inbox'))).toHaveLength(2);
    expect(await fs.readFile(path.join(root, 'inbox', first.filename), 'utf8')).toBe(first.content);
  });

  it('also avoids an id that is already in processing, archive, or has a result', async () => {
    const first = (await store().create(input, NOW)).id;
    await fs.unlink(path.join(root, 'inbox', `${first}.md`));
    await put('processing', `${first}.md`, 'x');
    await put('outbox', `${first}-2-result.md`, 'status: DONE');
    const next = await store().create(input, NOW);
    expect(next.id).toBe(`${first}-3`);
  });

  it('gives up with a conflict after a few attempts', async () => {
    const first = (await store().create(input, NOW)).id;
    await fs.unlink(path.join(root, 'inbox', `${first}.md`));
    await put('processing', `${first}.md`, 'x');
    for (const n of [2, 3, 4, 5, 6]) {
      await put('processing', `${first}-${n}.md`, 'x');
    }
    await expect(store().create(input, NOW)).rejects.toBeInstanceOf(BridgeConflictError);
  });

  it('reports an unavailable folder without exposing why', async () => {
    await fs.rm(path.join(root, 'inbox'), { recursive: true });
    await expect(store().create(input, NOW)).rejects.toBeInstanceOf(BridgeUnavailableError);
  });

  it('lets the list see what it just wrote', async () => {
    const built = await store().create({ ...input, priority: 'high' }, NOW);
    const { tasks } = await store().list(10);
    expect(tasks).toMatchObject([{ id: built.id, state: 'queued', priority: 'high' }]);
  });
});
