import path from 'path';
import { randomBytes } from 'crypto';
import { constants, promises as fs } from 'fs';
import type { TBridgePriority, TBridgeResult, TBridgeTask } from 'librechat-data-provider';
import type { BuiltTask, TaskInput } from './protocol';
import {
  BRIDGE_PRIORITIES,
  agentOfId,
  buildTaskFile,
  isTaskId,
  parseFrontmatter,
  parseResultStatus,
  toOneLine,
} from './protocol';

/** The shared task folder. Names come from a fixed pattern, never from a request. */
export class BridgeUnavailableError extends Error {
  constructor() {
    super('The task folder is not available');
    this.name = 'BridgeUnavailableError';
  }
}

export class BridgeConflictError extends Error {
  constructor() {
    super('Could not find a free task id');
    this.name = 'BridgeConflictError';
  }
}

export interface BridgeStoreOptions {
  tasksDir: string;
  maxResultBytes: number;
}

export interface BridgeListing {
  tasks: TBridgeTask[];
  truncated: boolean;
}

export type CreatedTask = BuiltTask;

type Location = 'inbox' | 'processing' | 'archive';

const TASK_FILE = /^(\d{4}-\d{2}-\d{2}-\d{4}-(?:hermes|openclaw)-[a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const RESULT_FILE =
  /^(\d{4}-\d{2}-\d{2}-\d{4}-(?:hermes|openclaw)-[a-z0-9]+(?:-[a-z0-9]+)*)-result\.md$/;
const HEAD_BYTES = 4096;
const RESULT_HEAD_BYTES = 512;
const SUMMARY_CHARS = 160;
const MAX_ATTEMPTS = 6;

const OPEN_READ = constants.O_RDONLY | constants.O_NOFOLLOW;

function codeOf(error: unknown): string | undefined {
  return error != null && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/** Reads up to `limit` bytes of a regular file without following a symlink. Null if it is not there. */
async function readUpTo(
  file: string,
  limit: number,
): Promise<{ text: string; truncated: boolean } | null> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, OPEN_READ);
    const stat = await handle.stat();
    if (!stat.isFile()) {
      return null;
    }
    const buffer = Buffer.alloc(Math.min(limit, stat.size));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer
      .subarray(0, bytesRead)
      .toString('utf8')
      .replaceAll(String.fromCharCode(0), '');
    return { text, truncated: stat.size > limit };
  } catch (error) {
    const code = codeOf(error);
    if (code === 'ENOENT' || code === 'ELOOP' || code === 'EISDIR' || code === 'ENOTDIR') {
      return null;
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export interface BridgeStore {
  list(limit: number): Promise<BridgeListing>;
  readResult(id: string): Promise<TBridgeResult | null>;
  create(input: TaskInput, now: Date): Promise<CreatedTask>;
}

export function createBridgeStore({ tasksDir, maxResultBytes }: BridgeStoreOptions): BridgeStore {
  const dirOf = (name: string): string => path.join(tasksDir, name);

  /** A subfolder must be a real directory: a symlink put there could point anywhere. */
  async function requireDir(name: string): Promise<string> {
    const dir = dirOf(name);
    try {
      const stat = await fs.lstat(dir);
      if (!stat.isDirectory()) {
        throw new BridgeUnavailableError();
      }
      return dir;
    } catch (error) {
      if (error instanceof BridgeUnavailableError) {
        throw error;
      }
      throw new BridgeUnavailableError();
    }
  }

  /** The regular files in a subfolder. Folders and symlinks are not tasks, so they are left out. */
  async function names(name: string, optional = false): Promise<string[]> {
    let dir: string;
    try {
      dir = await requireDir(name);
    } catch (error) {
      if (optional) {
        return [];
      }
      throw error;
    }
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch {
      throw new BridgeUnavailableError();
    }
  }

  async function list(limit: number): Promise<BridgeListing> {
    const [inbox, processing, archive, outbox] = await Promise.all([
      names('inbox'),
      names('processing'),
      names('archive', true),
      names('outbox'),
    ]);

    const where = new Map<string, Location>();
    const place = (files: string[], location: Location): void => {
      for (const file of files) {
        const id = TASK_FILE.exec(file)?.[1];
        if (id) {
          where.set(id, location);
        }
      }
    };
    place(inbox, 'inbox');
    place(processing, 'processing');
    place(archive, 'archive');

    const results = new Set<string>();
    for (const file of outbox) {
      const id = RESULT_FILE.exec(file)?.[1];
      if (id) {
        results.add(id);
      }
    }

    const ids = [...new Set([...where.keys(), ...results])].sort().reverse();
    const shown = ids.slice(0, limit);

    const tasks = await Promise.all(
      shown.map(async (id): Promise<TBridgeTask> => {
        const location = where.get(id);
        const [head, result] = await Promise.all([
          location ? readUpTo(path.join(dirOf(location), `${id}.md`), HEAD_BYTES) : null,
          results.has(id)
            ? readUpTo(path.join(dirOf('outbox'), `${id}-result.md`), RESULT_HEAD_BYTES)
            : null,
        ]);

        const front = head ? parseFrontmatter(head.text) : {};
        const priority = BRIDGE_PRIORITIES.includes(front.priority as TBridgePriority)
          ? (front.priority as TBridgePriority)
          : undefined;
        const resultStatus = result ? parseResultStatus(result.text) : undefined;
        const failed = resultStatus === 'FAILED';

        let state: TBridgeTask['state'];
        if (location === 'archive') {
          state = 'archived';
        } else if (location === 'inbox') {
          state = 'queued';
        } else if (result) {
          state = failed ? 'failed' : 'done';
        } else {
          state = location === 'processing' ? 'running' : 'queued';
        }

        return {
          id,
          to: agentOfId(id),
          state,
          ...(front.created ? { created: front.created.slice(0, 40) } : {}),
          ...(priority ? { priority } : {}),
          summary: toOneLine(front.task ?? '').slice(0, SUMMARY_CHARS),
          hasResult: result != null,
          ...(resultStatus ? { resultStatus } : {}),
        };
      }),
    );

    return { tasks, truncated: ids.length > shown.length };
  }

  async function readResult(id: string): Promise<TBridgeResult | null> {
    if (!isTaskId(id)) {
      return null;
    }
    await requireDir('outbox');
    const read = await readUpTo(path.join(dirOf('outbox'), `${id}-result.md`), maxResultBytes);
    if (!read) {
      return null;
    }
    return {
      id,
      status: parseResultStatus(read.text),
      text: read.text,
      truncated: read.truncated,
    };
  }

  async function exists(location: Location | 'outbox', file: string): Promise<boolean> {
    try {
      await fs.lstat(path.join(dirOf(location), file));
      return true;
    } catch (error) {
      if (codeOf(error) === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Writes the file under a dot-name nobody polls, then links it to its real name in one step: the
   * link fails rather than overwrite, and a half-written task is never visible to an agent.
   */
  async function writeNew(inbox: string, filename: string, content: string): Promise<boolean> {
    const temp = path.join(inbox, `.${filename}.${randomBytes(4).toString('hex')}.tmp`);
    const handle = await fs.open(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o644,
    );
    try {
      await handle.writeFile(content, 'utf8');
    } finally {
      await handle.close();
    }
    const final = path.join(inbox, filename);
    try {
      await fs.link(temp, final);
      return true;
    } catch (error) {
      if (codeOf(error) === 'EEXIST') {
        return false;
      }
      if (codeOf(error) === 'EPERM' || codeOf(error) === 'ENOTSUP') {
        if (await exists('inbox', filename)) {
          return false;
        }
        await fs.rename(temp, final);
        return true;
      }
      throw error;
    } finally {
      await fs.unlink(temp).catch(() => undefined);
    }
  }

  async function create(input: TaskInput, now: Date): Promise<CreatedTask> {
    const inbox = await requireDir('inbox');
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const built = buildTaskFile(input, { now, tasksDir, attempt });
      const taken =
        (await exists('processing', built.filename)) ||
        (await exists('archive', built.filename).catch(() => false)) ||
        (await exists('outbox', `${built.id}-result.md`));
      if (taken) {
        continue;
      }
      try {
        if (await writeNew(inbox, built.filename, built.content)) {
          return built;
        }
      } catch (error) {
        if (codeOf(error) === 'ENOENT' || codeOf(error) === 'EACCES' || codeOf(error) === 'EROFS') {
          throw new BridgeUnavailableError();
        }
        throw error;
      }
    }
    throw new BridgeConflictError();
  }

  return { list, readResult, create };
}
