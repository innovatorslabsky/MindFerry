import type { TBridgeAgent, TBridgePriority, TBridgeResultStatus } from 'librechat-data-provider';

/**
 * The task file protocol the agents already follow: one Markdown file per job, YAML frontmatter,
 * named `YYYY-MM-DD-HHMM-<agent>-<slug>.md`. Everything here is pure; nothing touches the disk.
 */

export const BRIDGE_AGENTS: readonly TBridgeAgent[] = ['hermes', 'openclaw'];
export const BRIDGE_PRIORITIES: readonly TBridgePriority[] = ['low', 'normal', 'high'];

/** Always written into `forbidden`; a person can add constraints, never remove these. */
export const FORBIDDEN_LINE =
  'no money moves, no publishing, no submitting, no deleting, no secrets';
export const STANDING_CONSTRAINT = 'Do not change any other file.';

const MAX_SLUG = 40;
const MAX_ID = 120;
const TASK_ID = /^\d{4}-\d{2}-\d{2}-\d{4}-(hermes|openclaw)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isTaskId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ID && TASK_ID.test(value);
}

/** The agent a valid task id is addressed to. */
export function agentOfId(id: string): TBridgeAgent {
  return id.includes('-openclaw-') ? 'openclaw' : 'hermes';
}

/** Zero-width and bidirectional-control characters hide text from a reader but not from an agent. */
const HIDDEN = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g;

/**
 * Collapses text to one line. A frontmatter value is a single line, so a line break in the input
 * would otherwise let a person (or text pasted into the form) start a new key such as `to:`.
 */
export function toOneLine(text: string): string {
  return text.replace(HIDDEN, '').replace(/\s+/g, ' ').replace(CONTROL, '').trim();
}

export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '');
  return slug === '' ? 'task' : slug;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** `2026-11-07-0143`, in UTC. */
export function stampOf(date: Date): string {
  const day = `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return `${day}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

/** `2026-11-07T01:43:00Z`, the minute-precision form the existing files use. */
export function isoMinute(date: Date): string {
  return `${stampOf(date).slice(0, 10)}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:00Z`;
}

const PLAIN_RESERVED = /^(true|false|null|yes|no|on|off|~|[-+]?\d[\d.:_eE+-]*)$/i;

/** Plain scalar when it is safe as one, otherwise a double-quoted one (JSON strings are valid YAML). */
export function yamlValue(value: string): string {
  const risky =
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) ||
    value.includes(': ') ||
    value.includes(' #') ||
    value.endsWith(':') ||
    PLAIN_RESERVED.test(value);
  return risky ? JSON.stringify(value) : value;
}

export interface TaskInput {
  to: TBridgeAgent;
  task: string;
  output?: string;
  constraints?: string;
  priority: TBridgePriority;
  /** Words the task's id is named from, when they should not be the task line itself. */
  slugSource?: string;
}

export interface BuiltTask {
  id: string;
  filename: string;
  content: string;
  resultPath: string;
}

const endsSentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);

/**
 * Builds a task file from already-validated input. `attempt` makes a new id when the first one is
 * taken (two tasks in the same minute with the same words). `tasksDir` is the path the agents see.
 */
export function buildTaskFile(
  input: TaskInput,
  options: { now: Date; tasksDir: string; attempt?: number },
): BuiltTask {
  const attempt = options.attempt ?? 1;
  const slug = slugify(input.slugSource ?? input.task) + (attempt > 1 ? `-${attempt}` : '');
  const id = `${stampOf(options.now)}-${input.to}-${slug}`;
  const resultPath = `${options.tasksDir.replace(/\/+$/, '')}/outbox/${id}-result.md`;

  const task = toOneLine(input.task);
  const output = input.output ? toOneLine(input.output) : '';
  const extra = input.constraints ? toOneLine(input.constraints) : '';
  const taskLine = [
    endsSentence(task),
    output ? `Expected output: ${endsSentence(output)}` : '',
    `Write the result to ${resultPath}, starting with a line "status: DONE" or "status: FAILED".`,
  ]
    .filter((part) => part !== '')
    .join(' ');
  const constraints = extra ? `${STANDING_CONSTRAINT} ${extra}` : STANDING_CONSTRAINT;

  const lines: Array<[string, string]> = [
    ['id', id],
    ['to', input.to],
    ['from', 'kem'],
    ['created', isoMinute(options.now)],
    ['priority', input.priority],
    ['task', taskLine],
    ['deliverable', resultPath],
    ['constraints', constraints],
    ['forbidden', FORBIDDEN_LINE],
    ['via', 'mindferry'],
  ];
  const body = lines.map(([key, value]) => `${key}: ${yamlValue(value)}`).join('\n');
  return { id, filename: `${id}.md`, content: `---\n${body}\n---\n`, resultPath };
}

const MAX_FRONTMATTER_LINES = 40;
const KEY_VALUE = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/;

function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'string' ? parsed : value;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/** Reads `key: value` lines from the leading `---` block. Not a YAML parser: display use only. */
export function parseFrontmatter(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/);
  const out: Record<string, string> = {};
  if (lines[0]?.trim() !== '---') {
    return out;
  }
  for (const line of lines.slice(1, MAX_FRONTMATTER_LINES + 1)) {
    if (line.trim() === '---') {
      break;
    }
    const match = KEY_VALUE.exec(line);
    if (match?.[1] && !(match[1] in out)) {
      out[match[1]] = unquote(match[2] ?? '');
    }
  }
  return out;
}

/** An agent's result starts with `status: DONE` or `status: FAILED`; anything else is unknown. */
export function parseResultStatus(text: string): TBridgeResultStatus {
  const first = text
    .split(/\r?\n/)
    .slice(0, 8)
    .map((line) => line.trim())
    .find((line) => line !== '');
  const match = first ? /^status:\s*(DONE|FAILED)\b/i.exec(first) : null;
  return match?.[1] ? (match[1].toUpperCase() as TBridgeResultStatus) : 'UNKNOWN';
}
