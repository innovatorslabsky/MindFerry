'use strict';
/** node --test hostinger/test-openclaw-tool-policy.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { apply, serialize, main, ALLOW, DENY, Conflict } = require('./openclaw-tool-policy.js');

const BASE = {
  meta: { lastTouchedVersion: '2026.10.10' },
  skills: { entries: { github: { enabled: false } } },
  agents: { entries: { main: {} } },
  plugins: { entries: { browser: { enabled: false } } },
};

test('stage 1 adds the minimal profile, three allowed tools and the deny list', () => {
  const out = apply(BASE);
  assert.equal(out.tools.profile, 'minimal');
  assert.deepEqual(out.tools.alsoAllow, ['read', 'write', 'ls']);
  assert.deepEqual(out.tools.deny, DENY);
});

test('everything else in the config is left exactly as it was', () => {
  const out = apply(BASE);
  const { tools: _tools, ...rest } = out;
  assert.deepEqual(rest, BASE);
});

test('the input object is never modified', () => {
  const copy = JSON.parse(JSON.stringify(BASE));
  apply(BASE);
  assert.deepEqual(BASE, copy);
});

test('it keeps the exec settings an earlier preset wrote under tools', () => {
  const withExec = {
    ...BASE,
    tools: { exec: { security: 'allowlist', ask: 'on-miss', askFallback: 'deny' } },
  };
  const out = apply(withExec);
  assert.deepEqual(out.tools.exec, withExec.tools.exec);
  assert.equal(out.tools.profile, 'minimal');
});

test('it refuses to replace a policy that is already set', () => {
  for (const key of ['profile', 'allow', 'alsoAllow', 'deny']) {
    assert.throws(
      () => apply({ tools: { [key]: key === 'profile' ? 'coding' : [] } }),
      Conflict,
      key,
    );
  }
});

test('it refuses a config or tools value of the wrong shape', () => {
  for (const bad of [null, [], 'x', 1]) {
    assert.throws(() => apply(bad), Conflict);
  }
  assert.throws(() => apply({ tools: [] }), Conflict);
  assert.throws(() => apply({ tools: null }), Conflict);
});

test('the policy lets a task be read and a result be written, and nothing that runs commands or reaches out', () => {
  assert.deepEqual(ALLOW, ['read', 'write', 'ls']);
  for (const needed of [
    'group:runtime',
    'group:web',
    'group:ui',
    'group:automation',
    'group:messaging',
    'group:nodes',
    'group:media',
    'group:sessions',
    'secrets',
  ]) {
    assert.ok(DENY.includes(needed), needed);
  }
  for (const allowed of ALLOW) {
    assert.ok(!DENY.includes(allowed), `${allowed} is both allowed and denied`);
  }
  assert.equal(new Set(DENY).size, DENY.length, 'duplicate entry');
});

test('stage 2 confines the file tools to the workspace and leaves the rest', () => {
  const stage1 = apply(BASE);
  const out = apply(stage1, 2);
  assert.equal(out.tools.fs.workspaceOnly, true);
  assert.deepEqual(out.tools.deny, stage1.tools.deny);
  assert.equal(out.tools.profile, 'minimal');
});

test('stage 2 keeps other tools.fs settings and refuses to override one that is set', () => {
  const out = apply({ tools: { fs: { other: 1 } } }, 2);
  assert.deepEqual(out.tools.fs, { other: 1, workspaceOnly: true });
  assert.throws(() => apply({ tools: { fs: { workspaceOnly: false } } }, 2), Conflict);
  assert.throws(() => apply(BASE, 3), Conflict);
});

test('the serialized file is two-space JSON with one trailing newline, and reads back the same', () => {
  const text = serialize(apply(BASE));
  assert.ok(text.endsWith('}\n') && !text.endsWith('\n\n'));
  assert.deepEqual(JSON.parse(text), apply(BASE));
});

function withFile(content, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocpolicy-'));
  const file = path.join(dir, 'openclaw.json');
  fs.writeFileSync(file, content);
  try {
    return run(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const quiet = { log: () => {}, err: () => {} };

test('the command writes only <file>.new and leaves the original byte for byte', () => {
  const original = JSON.stringify(BASE, null, 2) + '\n';
  withFile(original, (file) => {
    assert.equal(main([file], quiet.log, quiet.err), 0);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.new`, 'utf8')), apply(BASE));
    assert.equal(fs.statSync(`${file}.new`).mode & 0o777, 0o600);
  });
});

test('the command does not overwrite an existing .new, and writes nothing on a conflict', () => {
  withFile(JSON.stringify(BASE), (file) => {
    fs.writeFileSync(`${file}.new`, 'old');
    assert.equal(main([file], quiet.log, quiet.err), 3);
    assert.equal(fs.readFileSync(`${file}.new`, 'utf8'), 'old');
  });
  withFile(JSON.stringify({ tools: { deny: ['x'] } }), (file) => {
    assert.equal(main([file], quiet.log, quiet.err), 2);
    assert.ok(!fs.existsSync(`${file}.new`));
  });
});

test('the command reports a file that is not JSON, and bad usage, without writing', () => {
  withFile('{not json', (file) => {
    assert.equal(main([file], quiet.log, quiet.err), 3);
    assert.ok(!fs.existsSync(`${file}.new`));
  });
  assert.equal(main([], quiet.log, quiet.err), 3);
  assert.equal(main(['a', 'b'], quiet.log, quiet.err), 3);
  assert.equal(main(['a', '--stage', '9'], quiet.log, quiet.err), 3);
});

test('stage 2 through the command', () => {
  withFile(JSON.stringify(apply(BASE)), (file) => {
    assert.equal(main([file, '--stage', '2'], quiet.log, quiet.err), 0);
    assert.equal(JSON.parse(fs.readFileSync(`${file}.new`, 'utf8')).tools.fs.workspaceOnly, true);
  });
});

test('stage 2 with a workspace names it under agents.defaults and keeps the rest', () => {
  const stage1 = apply(BASE);
  const out = apply(stage1, 2, '/home/deploy/tasks');
  assert.equal(out.agents.defaults.workspace, '/home/deploy/tasks');
  assert.deepEqual(out.agents.entries, BASE.agents.entries);
  assert.equal(out.tools.fs.workspaceOnly, true);
  const withDefaults = apply({ agents: { defaults: { model: 'x' } } }, 2, '/w');
  assert.deepEqual(withDefaults.agents.defaults, { model: 'x', workspace: '/w' });
});

test('a workspace is refused when already set, when odd, or when the stage is not 2', () => {
  assert.throws(() => apply({ agents: { defaults: { workspace: '/a' } } }, 2, '/b'), Conflict);
  for (const bad of ['relative/dir', '/a/../b', '/a b', '/a;rm', '']) {
    assert.throws(() => apply(BASE, 2, bad), Conflict, bad);
  }
  assert.throws(() => apply(BASE, 1, '/home/deploy/tasks'), Conflict);
  assert.throws(() => apply({ agents: 5 }, 2, '/w'), Conflict);
});

test('the command takes --workspace with --stage 2 only', () => {
  withFile(JSON.stringify(apply(BASE)), (file) => {
    assert.equal(
      main([file, '--stage', '2', '--workspace', '/home/deploy/tasks'], quiet.log, quiet.err),
      0,
    );
    const written = JSON.parse(fs.readFileSync(`${file}.new`, 'utf8'));
    assert.equal(written.agents.defaults.workspace, '/home/deploy/tasks');
    assert.equal(written.tools.fs.workspaceOnly, true);
  });
  withFile(JSON.stringify(BASE), (file) => {
    assert.equal(main([file, '--workspace', '/w'], quiet.log, quiet.err), 2);
    assert.equal(fs.existsSync(`${file}.new`), false);
    assert.equal(main([file, '--stage', '2', '--workspace'], quiet.log, quiet.err), 3);
  });
});
