import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConversation, fitToLimits, conversationTitle } from './transcript.mjs';

function transcript(t, entries, { raw } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mindferry-transcript-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'transcript.jsonl');
  writeFileSync(path, raw ?? entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  return path;
}

const human = (content, extra = {}) => ({
  type: 'user',
  origin: { kind: 'human' },
  message: { role: 'user', content },
  ...extra,
});
const assistant = (...blocks) => ({
  type: 'assistant',
  message: { role: 'assistant', content: blocks },
});
const say = (text) => ({ type: 'text', text });

test('keeps what the user typed and what Claude said, in order', (t) => {
  const path = transcript(t, [
    human('first question'),
    assistant(say('first answer')),
    human('second question'),
    assistant(say('second answer')),
  ]);

  assert.deepEqual(readConversation(path).messages, [
    { role: 'user', text: 'first question' },
    { role: 'assistant', text: 'first answer' },
    { role: 'user', text: 'second question' },
    { role: 'assistant', text: 'second answer' },
  ]);
});

test('joins Claude text interleaved with tool calls into one answer, dropping thinking and tool use', (t) => {
  const path = transcript(t, [
    human('do the thing'),
    assistant({ type: 'thinking', thinking: 'private', signature: 'x' }),
    assistant(say('Looking at it now.'), { type: 'tool_use', id: 't1', name: 'Bash', input: {} }),
    {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ls output' }] },
    },
    assistant(say('Done: it works.')),
  ]);

  const { messages } = readConversation(path);

  assert.equal(messages.length, 2);
  assert.equal(messages[1].text, 'Looking at it now.\n\nDone: it works.');
  assert.doesNotMatch(JSON.stringify(messages), /private|ls output|Bash/);
});

test('leaves out everything the user did not type', (t) => {
  const path = transcript(t, [
    human('a real message'),
    assistant(say('reply')),
    {
      type: 'user',
      isMeta: true,
      message: { content: '<local-command-caveat>Caveat: ignore</local-command-caveat>' },
    },
    {
      type: 'user',
      origin: { kind: 'task-notification' },
      message: { content: '<task-notification>done</task-notification>' },
    },
    {
      type: 'user',
      origin: { kind: 'peer' },
      message: { content: 'Another Claude session sent a message' },
    },
    human('<command-name>/model</command-name> <command-args>x</command-args>'),
    human('This session is being continued from a previous conversation that ran out of context.'),
    human('sidechain message', { isSidechain: true }),
    { ...assistant(say('subagent chatter')), isSidechain: true },
    { ...assistant(say('API error text')), isApiErrorMessage: true },
  ]);

  const { messages } = readConversation(path);

  assert.deepEqual(
    messages.map((message) => message.text),
    ['a real message', 'reply'],
  );
});

test('accepts an entry with no origin field, as older Claude Code versions write them', (t) => {
  const path = transcript(t, [
    { type: 'user', message: { content: 'plain old entry' } },
    assistant(say('reply')),
  ]);

  assert.equal(readConversation(path).messages[0].text, 'plain old entry');
});

test('keeps the text of a message that also carries an image, without the image', (t) => {
  const path = transcript(t, [
    human([
      { type: 'image', source: { type: 'base64', data: 'AAAA' } },
      { type: 'text', text: 'what is in this screenshot' },
    ]),
    assistant(say('a chart')),
  ]);

  const { messages } = readConversation(path);

  assert.equal(messages[0].text, 'what is in this screenshot');
  assert.doesNotMatch(JSON.stringify(messages), /AAAA/);
});

test('skips malformed lines and unknown entry types instead of failing', (t) => {
  const path = transcript(t, [], {
    raw: [
      '{not json',
      '',
      JSON.stringify({ type: 'something-new', payload: 1 }),
      JSON.stringify(human('survivor')),
      JSON.stringify({ type: 'user' }),
      JSON.stringify(assistant(say('still here'))),
    ].join('\n'),
  });

  assert.deepEqual(
    readConversation(path).messages.map((message) => message.text),
    ['survivor', 'still here'],
  );
});

test('ignores Claude text that comes before any user message', (t) => {
  const path = transcript(t, [assistant(say('orphan')), human('hello'), assistant(say('hi'))]);

  assert.deepEqual(
    readConversation(path).messages.map((message) => message.text),
    ['hello', 'hi'],
  );
});

test('returns nothing for a missing transcript or path', () => {
  assert.deepEqual(readConversation('/does/not/exist.jsonl').messages, []);
  assert.deepEqual(readConversation(undefined).messages, []);
});

test('reads the last session title Claude Code wrote', (t) => {
  const path = transcript(t, [
    { type: 'ai-title', aiTitle: 'First title' },
    human('q'),
    { type: 'ai-title', aiTitle: 'Better title' },
  ]);

  assert.equal(readConversation(path).aiTitle, 'Better title');
});

test('cuts an over-long turn and says how much was cut', () => {
  const { messages, dropped } = fitToLimits([{ role: 'user', text: 'x'.repeat(500) }], {
    maxBytes: 100_000,
    maxTurnChars: 100,
    maxTurns: 10,
  });

  assert.equal(dropped, 0);
  assert.match(messages[0].text, /^x{100}\n\n\[… cut: 400 more characters\]$/);
});

test('drops the oldest turns to fit the size, keeping the newest, and marks the omission', () => {
  const turns = Array.from({ length: 6 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    text: `${i}`.repeat(100),
  }));

  const { messages, dropped } = fitToLimits(turns, {
    maxBytes: 350,
    maxTurnChars: 1000,
    maxTurns: 10,
  });

  assert.equal(dropped, 3);
  assert.equal(messages.length, 3);
  assert.match(messages[0].text, /^\[earlier conversation not archived: 3 turn\(s\) omitted/);
  assert.match(messages[0].text, /333/);
  assert.match(messages[2].text, /^5{100}$/);
});

test('respects the turn count limit the hub enforces', () => {
  const turns = Array.from({ length: 10 }, (_, i) => ({ role: 'user', text: `turn ${i}` }));

  const { messages, dropped } = fitToLimits(turns, {
    maxBytes: 100_000,
    maxTurnChars: 1000,
    maxTurns: 4,
  });

  assert.equal(dropped, 6);
  assert.equal(messages.length, 4);
});

test('adds no marker and changes nothing when everything fits', () => {
  const turns = [
    { role: 'user', text: 'a' },
    { role: 'assistant', text: 'b' },
  ];

  const { messages, dropped } = fitToLimits(turns, {
    maxBytes: 1000,
    maxTurnChars: 1000,
    maxTurns: 10,
  });

  assert.equal(dropped, 0);
  assert.deepEqual(messages, turns);
});

test('titles a session by Claude Code’s own title, else its opening request, with the project name', () => {
  const messages = [{ role: 'user', text: 'Fix the login   bug\nplease' }];

  assert.equal(
    conversationTitle({ aiTitle: 'Login bug', messages, cwd: '/home/u/shop' }),
    'Login bug — shop',
  );
  assert.equal(
    conversationTitle({ messages, cwd: '/home/u/shop' }),
    'Fix the login bug please — shop',
  );
  assert.equal(conversationTitle({ messages: [] }), 'Session');
});

test('shortens a very long opening request in the title', () => {
  const title = conversationTitle({ messages: [{ role: 'user', text: 'word '.repeat(100) }] });

  assert.ok(title.length <= 81, `title too long: ${title.length}`);
  assert.ok(title.endsWith('…'));
});
