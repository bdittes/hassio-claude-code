import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = new URL('../../rootfs/usr/local/bin/ha-yaml-check', import.meta.url).pathname;
const hasPyYaml = spawnSync('python3', ['-c', 'import yaml'], { encoding: 'utf8' }).status === 0;

function run(cwd: string, ...args: string[]) {
  const r = spawnSync('python3', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function fixture(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-yaml-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

describe('ha-yaml-check', { skip: !hasPyYaml && 'python3 with PyYAML not available' }, () => {
  test('accepts a valid config with Home Assistant tags', () => {
    const dir = fixture({
      'configuration.yaml': 'automation: !include automations.yaml\nhomeassistant:\n  packages: !include_dir_named packages\nhttp:\n  pw: !secret http_pw\n',
      'automations.yaml': "- id: '1'\n  alias: x\n  triggers: []\n  actions: []\n",
      'packages/a.yaml': 'input_boolean:\n  a:\n    name: A\n',
      'secrets.yaml': 'http_pw: TOPSECRET\n',
      'blueprints/automation/b.yaml': 'blueprint:\n  name: b\n  domain: automation\nactions:\n  - target: !input t\n',
    });
    try {
      const r = run(dir);
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, /0 error/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports syntax errors, duplicate keys, missing includes and secrets without leaking values', () => {
    const dir = fixture({
      'configuration.yaml': 'script: !include scripts.yaml\nhttp:\n  pw: !secret nope\nlight: []\nlight: []\nfoo: !bogus x\n',
      'packages/broken.yaml': 'a:\n  b: 1\n   c: 2\n',
      'secrets.yaml': 'other: TOPSECRET\n',
      '.storage/core.config_entries': '{',
    });
    try {
      const r = run(dir);
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /configuration\.yaml:1:\d+: error: !include scripts\.yaml: file not found/);
      assert.match(r.out, /configuration\.yaml:3:\d+: error: !secret nope: key not found/);
      assert.match(r.out, /configuration\.yaml:5:1: error: duplicate key 'light' \(first defined on line 4\)/);
      assert.match(r.out, /unknown tag !bogus/);
      assert.match(r.out, /packages\/broken\.yaml:3:\d+: error:/);
      assert.doesNotMatch(r.out, /TOPSECRET/);
      assert.doesNotMatch(r.out, /\.storage/);
      assert.match(run(dir, 'secrets.yaml').out, /skipped \(protected file\)/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
