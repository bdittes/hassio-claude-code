import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';

describe('displayed version', () => {
  const saved = process.env.CLAUDE_HA_VERSION;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_HA_VERSION;
    else process.env.CLAUDE_HA_VERSION = saved;
  });

  test('is the add-on version the run script exports, not server/package.json', () => {
    process.env.CLAUDE_HA_VERSION = '0.1.8.2';
    assert.equal(loadConfig().version, '0.1.8.2');
  });

  test('falls back to package.json outside the add-on', () => {
    delete process.env.CLAUDE_HA_VERSION;
    assert.match(loadConfig().version, /^\d+\.\d+\.\d+/);
  });

  test("ignores bashio's 'null' for a missing value", () => {
    process.env.CLAUDE_HA_VERSION = 'null';
    assert.notEqual(loadConfig().version, 'null');
  });
});
