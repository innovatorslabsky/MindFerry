#!/usr/bin/env node
/**
 * Prepares a tool policy for OpenClaw's openclaw.json. It reads the file, adds the policy and writes
 * the result next to it as <file>.new. It never changes the original: a person compares the two with
 * diff, moves the new file into place, validates and restarts (see README-agents.md, Part 4).
 *
 *   node openclaw-tool-policy.js <openclaw.json> [--stage 2]
 *
 * Stage 1 (default): the "minimal" profile plus read, write and ls, and an explicit deny of command
 *   running, web, the interface tools, automation, messaging, nodes, media, sessions and plugins, so a
 *   tool added later is not available by accident. "Deny wins" in OpenClaw's tool policy.
 * Stage 2: also confine the file tools to the workspace folder (tools.fs.workspaceOnly).
 *
 * Exits 0 when it wrote the file, 2 when the config already sets one of these keys (nothing written),
 * 3 on a usage error. No secret is read or printed.
 */
'use strict';
const fs = require('node:fs');

const ALLOW = ['read', 'write', 'ls'];
const DENY = [
  'group:runtime',
  'group:web',
  'group:ui',
  'group:automation',
  'group:messaging',
  'group:nodes',
  'group:media',
  'group:sessions',
  'group:plugins',
  'secrets',
  'dispatch_action',
  'file_write',
  'file_fetch',
  'dir_fetch',
  'dir_list',
  'github_publish',
  'skill_workshop',
  'skill_library',
  'transcripts',
];

class Conflict extends Error {
  constructor(message) {
    super(message);
    this.name = 'Conflict';
  }
}

/** The config with the policy added. Throws Conflict instead of replacing something already set. */
function apply(config, stage = 1) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Conflict('the config is not a JSON object');
  }
  const out = JSON.parse(JSON.stringify(config));
  const tools = out.tools === undefined ? {} : out.tools;
  if (tools === null || typeof tools !== 'object' || Array.isArray(tools)) {
    throw new Conflict('tools is not an object');
  }
  if (stage === 1) {
    for (const key of ['profile', 'allow', 'alsoAllow', 'deny']) {
      if (key in tools) {
        throw new Conflict(`tools.${key} is already set`);
      }
    }
    tools.profile = 'minimal';
    tools.alsoAllow = [...ALLOW];
    tools.deny = [...DENY];
  } else if (stage === 2) {
    const fsPolicy = tools.fs === undefined ? {} : tools.fs;
    if (fsPolicy === null || typeof fsPolicy !== 'object' || Array.isArray(fsPolicy)) {
      throw new Conflict('tools.fs is not an object');
    }
    if ('workspaceOnly' in fsPolicy) {
      throw new Conflict('tools.fs.workspaceOnly is already set');
    }
    fsPolicy.workspaceOnly = true;
    tools.fs = fsPolicy;
  } else {
    throw new Conflict(`unknown stage ${stage}`);
  }
  out.tools = tools;
  return out;
}

const serialize = (config) => `${JSON.stringify(config, null, 2)}\n`;

function main(argv, log = console.log, err = console.error) {
  const args = argv.slice();
  let stage = 1;
  const at = args.indexOf('--stage');
  if (at !== -1) {
    stage = Number(args[at + 1]);
    args.splice(at, 2);
  }
  if (args.length !== 1 || !(stage === 1 || stage === 2)) {
    err('usage: node openclaw-tool-policy.js <openclaw.json> [--stage 2]');
    return 3;
  }
  const file = args[0];
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    err(`cannot read ${file} as JSON (${error.code || error.name})`);
    return 3;
  }
  let next;
  try {
    next = apply(config, stage);
  } catch (error) {
    if (error instanceof Conflict) {
      err(`nothing written: ${error.message}`);
      return 2;
    }
    throw error;
  }
  try {
    fs.writeFileSync(`${file}.new`, serialize(next), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    err(`nothing written: ${file}.new ${error.code === 'EEXIST' ? 'already exists, remove it first' : 'cannot be created'}`);
    return 3;
  }
  log(`wrote ${file}.new (stage ${stage}); ${file} is unchanged`);
  return 0;
}

module.exports = { apply, serialize, main, ALLOW, DENY, Conflict };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
