import type { HubThread, HubMessage } from './thread';
import { renderThreadMarkdown, threadOutline, renderThreadOutlineMarkdown } from './render';

const thread = (messages: HubMessage[], title = 'A Thread'): HubThread => ({
  id: 'claude:abc',
  provider: 'claude',
  sourceId: 'abc',
  title,
  createdAt: new Date('2024-01-07T10:00:00Z'),
  updatedAt: new Date('2024-01-08T11:00:00Z'),
  messages,
});

const message = (overrides: Partial<HubMessage>): HubMessage => ({
  id: 'm1',
  role: 'user',
  createdAt: new Date('2024-01-07T10:00:00Z'),
  segments: [{ kind: 'text', text: 'hello' }],
  parentId: null,
  ...overrides,
});

describe('renderThreadMarkdown', () => {
  it('opens with frontmatter carrying the thread identity', () => {
    const markdown = renderThreadMarkdown(thread([message({})]));

    expect(markdown).toContain('id: "claude:abc"');
    expect(markdown).toContain('provider: claude');
    expect(markdown).toContain('createdAt: 2024-01-07T10:00:00.000Z');
    expect(markdown).toContain('messages: 1');
  });

  it('escapes a title that would break the YAML scalar', () => {
    const markdown = renderThreadMarkdown(thread([message({})], 'He said "hi"\nthen left'));

    expect(markdown).toContain('title: "He said \\"hi\\" then left"');
  });

  it('labels each turn with its role and timestamp', () => {
    const markdown = renderThreadMarkdown(
      thread([
        message({ role: 'user' }),
        message({
          id: 'm2',
          role: 'assistant',
          parentId: 'm1',
          model: 'claude-opus-4',
          segments: [{ kind: 'text', text: 'hi back' }],
        }),
      ]),
    );

    expect(markdown).toContain('## User · 2024-01-07T10:00:00.000Z');
    expect(markdown).toContain('## Assistant · 2024-01-07T10:00:00.000Z · claude-opus-4');
  });

  it('fences thinking, code and tool segments distinctly', () => {
    const markdown = renderThreadMarkdown(
      thread([
        message({
          role: 'assistant',
          segments: [
            { kind: 'thinking', text: 'let me think' },
            { kind: 'code', text: 'print(1)', language: 'python' },
            { kind: 'tool', text: '{"q":1}', name: 'search' },
          ],
        }),
      ]),
    );

    expect(markdown).toContain('```thinking\nlet me think\n```');
    expect(markdown).toContain('```python\nprint(1)\n```');
    expect(markdown).toContain('```tool:search\n{"q":1}\n```');
  });

  it('lengthens the fence so an embedded code block cannot close it early', () => {
    const markdown = renderThreadMarkdown(
      thread([
        message({
          role: 'assistant',
          segments: [{ kind: 'thinking', text: 'see:\n```js\nconst a = 1;\n```' }],
        }),
      ]),
    );

    expect(markdown).toContain('````thinking\n');
    expect(markdown).toContain('const a = 1;\n```\n````');
  });

  it('ends with a single trailing newline so the file is diff-stable', () => {
    const markdown = renderThreadMarkdown(thread([message({})]));

    expect(markdown.endsWith('\n')).toBe(true);
    expect(markdown.endsWith('\n\n')).toBe(false);
  });

  describe('messageIds option', () => {
    const twoMessages = () =>
      thread([
        message({ id: 'm1', role: 'user', segments: [{ kind: 'text', text: 'first turn' }] }),
        message({
          id: 'm2',
          role: 'assistant',
          parentId: 'm1',
          segments: [{ kind: 'text', text: 'second turn' }],
        }),
      ]);

    it('renders every message when omitted, unchanged from before this option existed', () => {
      const markdown = renderThreadMarkdown(twoMessages());

      expect(markdown).toContain('first turn');
      expect(markdown).toContain('second turn');
      expect(markdown).not.toContain('shown:');
    });

    it("renders only the requested messages, in the thread's own order", () => {
      const markdown = renderThreadMarkdown(twoMessages(), { messageIds: ['m2'] });

      expect(markdown).not.toContain('first turn');
      expect(markdown).toContain('second turn');
    });

    it('records the true total alongside how many are shown', () => {
      const markdown = renderThreadMarkdown(twoMessages(), { messageIds: ['m1'] });

      expect(markdown).toContain('messages: 2');
      expect(markdown).toContain('shown: 1');
    });

    it('silently drops an unknown message id rather than erroring', () => {
      const markdown = renderThreadMarkdown(twoMessages(), {
        messageIds: ['m1', 'does-not-exist'],
      });

      expect(markdown).toContain('first turn');
      expect(markdown).toContain('shown: 1');
    });
  });
});

describe('threadOutline', () => {
  it('is empty for a thread with no messages', () => {
    expect(threadOutline(thread([]))).toEqual([]);
  });

  it('carries id, role, and timestamp for every message, without segment bodies', () => {
    const [entry] = threadOutline(
      thread([message({ id: 'm1', role: 'assistant', segments: [{ kind: 'text', text: 'hi' }] })]),
    );

    expect(entry.id).toBe('m1');
    expect(entry.role).toBe('assistant');
    expect(entry.createdAt).toEqual(new Date('2024-01-07T10:00:00Z'));
  });

  it('truncates a long message to the preview length, with an ellipsis', () => {
    const [entry] = threadOutline(
      thread([message({ segments: [{ kind: 'text', text: 'x'.repeat(500) }] })]),
      50,
    );

    expect(entry.preview.length).toBe(51); // 50 chars + the ellipsis character
    expect(entry.preview.endsWith('…')).toBe(true);
  });

  it('leaves a short message untruncated, with no ellipsis', () => {
    const [entry] = threadOutline(thread([message({ segments: [{ kind: 'text', text: 'hi' }] })]));

    expect(entry.preview).toBe('hi');
  });

  it('collapses newlines and repeated whitespace in the preview', () => {
    const [entry] = threadOutline(
      thread([message({ segments: [{ kind: 'text', text: 'line one\n\n  line two' }] })]),
    );

    expect(entry.preview).toBe('line one line two');
  });

  it('lists every distinct segment kind present, in first-seen order', () => {
    const [entry] = threadOutline(
      thread([
        message({
          segments: [
            { kind: 'thinking', text: 'planning' },
            { kind: 'text', text: 'answer' },
            { kind: 'code', text: 'print(1)' },
            { kind: 'thinking', text: 'more planning' },
          ],
        }),
      ]),
    );

    expect(entry.kinds).toEqual(['thinking', 'text', 'code']);
  });
});

describe('renderThreadOutlineMarkdown', () => {
  it('lists every message as one compact entry, without full segment text', () => {
    const markdown = renderThreadOutlineMarkdown(
      thread([
        message({
          id: 'm1',
          role: 'user',
          segments: [{ kind: 'text', text: 'How do backups work?' }],
        }),
        message({
          id: 'm2',
          role: 'assistant',
          parentId: 'm1',
          segments: [{ kind: 'text', text: 'x'.repeat(1000) }],
        }),
      ]),
    );

    expect(markdown).toContain('- m1 · User ·');
    expect(markdown).toContain('How do backups work?');
    expect(markdown).toContain('- m2 · Assistant ·');
    expect(markdown).not.toContain('x'.repeat(1000));
  });

  it('flags a non-text segment kind inline, so a caller can spot reasoning or code turns', () => {
    const markdown = renderThreadOutlineMarkdown(
      thread([
        message({
          role: 'assistant',
          segments: [
            { kind: 'thinking', text: 'reasoning' },
            { kind: 'text', text: 'answer' },
          ],
        }),
      ]),
    );

    expect(markdown).toContain('· thinking');
  });

  it('says so plainly for a thread with no messages', () => {
    const markdown = renderThreadOutlineMarkdown(thread([]));

    expect(markdown).toContain('(no messages)');
  });
});
